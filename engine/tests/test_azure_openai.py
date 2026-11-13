"""The Azure OpenAI proposer, against a mock transport — no network, no key.

Pins the request shape the three provider rules depend on (forced, strict tool
call; the deployment as the model; temperature 0) and how answers, token usage
and failures are read back.
"""

from __future__ import annotations

import json
from collections.abc import Callable
from typing import Any
from uuid import uuid4

import httpx
import pytest

from agent.graph import AzureOpenAIProposer, build_proposer
from agent.prompts import SUBMIT_RESOLUTION_NAME, has_api_key, missing_settings
from pipeline.schema import Conflict, SurvivorshipRule

RULES = [
    SurvivorshipRule(
        id="territory-most-recent",
        field="territory",
        entity_type="*",
        strategy="most_recent",
        description="Territory follows the most recent edit.",
    )
]


def conflict() -> Conflict:
    return Conflict(
        id=uuid4(),
        run_id=uuid4(),
        match_id=uuid4(),
        field="segment",
        value_a="Enterprise",
        value_b="Mid-Market",
        conflict_class="attribute",
        severity=2,
        detected_by="rule",
    )


def answer(arguments: dict[str, Any], *, prompt: int = 1200, cached: int = 1024) -> dict[str, Any]:
    return {
        "model": "gpt-4.1-mini-2025-04-14",
        "choices": [
            {
                "message": {
                    "role": "assistant",
                    "tool_calls": [
                        {
                            "id": "call_1",
                            "type": "function",
                            "function": {
                                "name": SUBMIT_RESOLUTION_NAME,
                                "arguments": json.dumps(arguments),
                            },
                        }
                    ],
                }
            }
        ],
        "usage": {
            "prompt_tokens": prompt,
            "completion_tokens": 80,
            "prompt_tokens_details": {"cached_tokens": cached},
        },
    }


def client_for(handler: Callable[[httpx.Request], httpx.Response]) -> httpx.Client:
    return httpx.Client(
        base_url="https://canon-test.openai.azure.com/openai/v1/",
        headers={"api-key": "test-key"},
        transport=httpx.MockTransport(handler),
    )


def test_request_forces_a_strict_tool_call_on_the_deployment() -> None:
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(
            200,
            json=answer(
                {
                    "proposed_value": "Enterprise",
                    "confidence": 0.9,
                    "rationale": "CRM is newer. Chose Enterprise.",
                    "applied_rule_id": None,
                }
            ),
        )

    proposer = AzureOpenAIProposer(
        RULES, client=client_for(handler), model="gpt-4.1-mini-2025-04-14"
    )
    proposal = proposer(conflict(), None, ("Salesforce", "Databricks"))

    assert proposal is not None and proposal.proposed_value == "Enterprise"
    request = seen[0]
    assert request.url.path == "/openai/v1/chat/completions"
    assert request.headers["api-key"] == "test-key"

    body = json.loads(request.content)
    assert body["model"] == "gpt-4.1-mini-2025-04-14"
    assert body["tool_choice"] == {"type": "function", "function": {"name": SUBMIT_RESOLUTION_NAME}}
    assert body["parallel_tool_calls"] is False
    assert body["temperature"] == 0
    tool = body["tools"][0]["function"]
    assert tool["strict"] is True
    assert tool["parameters"]["additionalProperties"] is False
    # The ruleset is the system message — the cacheable prefix.
    assert body["messages"][0]["role"] == "system"
    assert "Survivorship policy" in body["messages"][0]["content"]


def test_cached_prompt_tokens_are_not_billed_twice() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json=answer(
                {
                    "proposed_value": "",
                    "confidence": 0.2,
                    "rationale": "Ambiguous.",
                    "applied_rule_id": None,
                },
                prompt=1200,
                cached=1024,
            ),
        )

    proposer = AzureOpenAIProposer(RULES, client=client_for(handler), model="d")
    proposer(conflict(), None, ("A", "B"))

    assert proposer.usage.calls == 1
    assert proposer.usage.input_tokens == 176
    assert proposer.usage.cache_read_tokens == 1024
    assert proposer.usage.output_tokens == 80
    assert proposer.usage.total_tokens == 1280


def test_a_missing_deployment_halts_the_proposer() -> None:
    calls = 0

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        return httpx.Response(404, json={"error": {"code": "DeploymentNotFound"}})

    proposer = AzureOpenAIProposer(RULES, client=client_for(handler), model="missing")
    for _ in range(3):
        assert proposer(conflict(), None, ("A", "B")) is None

    assert calls == 1
    assert proposer.halted
    assert proposer.usage.errors == 3
    assert "DeploymentNotFound" in proposer.usage.first_error


def test_a_rate_limit_is_retried_after_the_advised_wait(monkeypatch: pytest.MonkeyPatch) -> None:
    waits: list[float] = []
    monkeypatch.setattr("agent.graph.time.sleep", waits.append)
    responses = iter(
        [
            httpx.Response(429, headers={"retry-after": "3"}, json={"error": {}}),
            httpx.Response(
                200,
                json=answer(
                    {
                        "proposed_value": "Mid-Market",
                        "confidence": 0.9,
                        "rationale": "r",
                        "applied_rule_id": None,
                    }
                ),
            ),
        ]
    )

    proposer = AzureOpenAIProposer(
        RULES, client=client_for(lambda request: next(responses)), model="d"
    )
    proposal = proposer(conflict(), None, ("A", "B"))

    assert proposal is not None and proposal.proposed_value == "Mid-Market"
    assert waits == [4.0]  # the advised 3s plus one second of headroom
    assert proposer.usage.rate_limited == 1
    assert proposer.usage.errors == 0


def test_an_unparseable_answer_is_no_proposal() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        body = answer({})
        body["choices"][0]["message"]["tool_calls"][0]["function"]["arguments"] = "{not json"
        return httpx.Response(200, json=body)

    proposer = AzureOpenAIProposer(RULES, client=client_for(handler), model="d")
    assert proposer(conflict(), None, ("A", "B")) is None


def test_configuration_needs_both_endpoint_and_key(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("AZURE_OPENAI_API_KEY", "k")
    monkeypatch.delenv("AZURE_OPENAI_ENDPOINT", raising=False)

    assert not has_api_key("azure_openai")
    assert missing_settings("azure_openai") == ["AZURE_OPENAI_ENDPOINT"]
    assert not build_proposer(RULES, provider="azure_openai").available

    monkeypatch.setenv("AZURE_OPENAI_ENDPOINT", "https://canon-test.openai.azure.com/")
    assert has_api_key("azure_openai")
    assert build_proposer(RULES, provider="azure_openai").available
