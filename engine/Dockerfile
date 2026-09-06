FROM python:3.12-slim
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv
WORKDIR /app

ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    HF_HOME=/app/.hf \
    VIRTUAL_ENV=/app/.venv \
    PATH=/app/.venv/bin:$PATH

# Dependencies before source, so an edit to main.py does not re-resolve torch.
# --no-install-project because pyproject declares agent/, connectors/, eval/ and
# pipeline/ as the wheel's packages and they are not copied yet.
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project

# Swap in the CPU-only build of the SAME torch the lock pins.
#
# torch reaches this project transitively through sentence-transformers, so
# [tool.uv.sources] cannot redirect it — uv sources apply only to direct
# dependencies. PyPI's Linux wheel bundles the CUDA runtime: ~2.5 GB of GPU
# libraries for a pipeline that only ever runs all-MiniLM-L6-v2 on CPU. The
# version is pinned to uv.lock's, so this is the same torch with the GPU
# payload removed, not a different one. RAISE IT WHEN THE LOCK MOVES.
RUN uv pip install --no-cache torch==2.13.0 --index-url https://download.pytorch.org/whl/cpu

COPY . .

# Everything below runs the venv's python directly rather than `uv run`, which
# re-syncs against the lock on every invocation and would reinstall the CUDA
# wheel the step above just removed.

# Bake the embedding weights in. Otherwise the first run of a cold container
# downloads them from HuggingFace mid-demo, or silently falls back to
# RapidFuzz-only blocking if the network says no — which changes the matching
# numbers without saying so.
RUN python -c "from sentence_transformers import SentenceTransformer; SentenceTransformer('sentence-transformers/all-MiniLM-L6-v2')"

# engine/data/ is gitignored and reproducible from its seed, so generate it here
# rather than shipping it. Same seed as the reported results.
RUN python -m eval.generate --seed 42 --accounts 500 --out ./data/run42

ENV CANON_DATASET_ROOT=/app/data \
    CANON_SYNTHETIC_DATA_DIR=/app/data/run42
EXPOSE 8000
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
