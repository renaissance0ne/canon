import { notFound } from "next/navigation";
import { PageHeader } from "@/components/console/page-header";
import { ConnectSourceForm } from "@/components/sources/connect-source-form";
import { requireReviewer } from "@/lib/server/auth";
import { readStatus } from "@/lib/server/credentials";
import { credentialEncryptionReady } from "@/lib/server/crypto";
import { oauthConfigured } from "@/lib/server/oauth";
import { getSource } from "@/lib/server/sources";
import { isUuid } from "@/lib/uuid";
import { requiresCredentials } from "@/types/credentials";
import { SOURCE_KIND_LABEL } from "@/types/source";

/**
 * Connect a source. A Server Component, like everything else in the console —
 * the credential status is read here and passed down already redacted, so the
 * client bundle has no code path that could ask for a secret.
 *
 * `?error=` and `?notice=` arrive from the OAuth routes, which redirect back
 * here rather than rendering their own page: someone three clicks into
 * connecting a warehouse should land where they started.
 */
export default async function ConnectSourcePage({
  params,
  searchParams,
}: {
  params: Promise<{ sourceId: string }>;
  searchParams: Promise<{ error?: string; notice?: string }>;
}) {
  await requireReviewer();

  const { sourceId } = await params;
  if (!isUuid(sourceId)) notFound();

  const source = await getSource(sourceId);
  if (!source) notFound();

  const { error, notice } = await searchParams;

  // `synthetic` reads generated files from disk. There is no remote system to
  // authenticate against, so this screen has nothing to ask for.
  if (!requiresCredentials(source.kind)) {
    return (
      <>
        <PageHeader title={source.name} meta={SOURCE_KIND_LABEL[source.kind]} />
        <div className="px-10 py-8">
          <p className="max-w-[460px] border-l-2 border-g-900 pl-3 text-body text-g-600">
            Synthetic sources are generated locally from a seed by{" "}
            <span className="font-mono">engine/eval/generate.py</span>. There is
            nothing to authenticate against, and nothing to store.
          </p>
        </div>
      </>
    );
  }

  const [credential, encryptionReady] = await Promise.all([
    readStatus(sourceId),
    Promise.resolve(credentialEncryptionReady()),
  ]);

  return (
    <>
      <PageHeader
        title={source.name}
        meta={`${SOURCE_KIND_LABEL[source.kind]} · PUT /api/sources/${sourceId}/credentials`}
      />

      <div className="flex flex-col gap-6 px-10 py-8">
        {error ? (
          <p
            role="alert"
            className="max-w-[560px] border border-g-900 bg-surface-sunken px-3 py-2 text-body text-g-900"
          >
            {error}
          </p>
        ) : null}

        {notice ? (
          <p className="max-w-[560px] border-l-2 border-g-900 pl-3 text-body text-g-600">{notice}</p>
        ) : null}

        <ConnectSourceForm
          source={source}
          credential={credential}
          oauthAvailable={oauthConfigured(source.kind, "oauth2")}
          encryptionReady={encryptionReady}
        />
      </div>
    </>
  );
}
