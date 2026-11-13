import { pathToFileURL } from "node:url";

/** Invoke the private controller's fixed-main build capability after CI passes. */
export async function requestDeployment(env, request = fetch) {
  if (
    env.GITHUB_EVENT_NAME !== "push" ||
    env.GITHUB_REPOSITORY !== "yogenpro/beanbag" ||
    env.GITHUB_REF !== "refs/heads/main"
  )
    throw new Error(
      "Only this repository's main pushes may request deployment",
    );
  if (!/^[a-f0-9]{40}$/.test(env.GITHUB_SHA ?? ""))
    throw new Error("Invalid source revision");
  const hook = env.BEANBAG_DEPLOY_HOOK ?? "";
  if (
    !/^https:\/\/api\.cloudflare\.com\/client\/v4\/workers\/builds\/deploy_hooks\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(
      hook,
    )
  )
    throw new Error("Missing or invalid deployment capability");
  let head;
  try {
    const response = await request(
      "https://api.github.com/repos/yogenpro/beanbag/git/ref/heads/main",
      {
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${env.GITHUB_TOKEN}`,
        },
        redirect: "error",
        signal: AbortSignal.timeout(30_000),
      },
    );
    if (!response.ok) throw new Error();
    head = (await response.json()).object.sha;
  } catch {
    throw new Error("Unable to verify the current main revision");
  }
  if (head !== env.GITHUB_SHA) return { state: "superseded" };
  try {
    const response = await request(hook, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error();
    const body = await response.json();
    if (body.success !== true || typeof body.result?.build_uuid !== "string")
      throw new Error();
  } catch {
    throw new Error("Cloudflare build request failed; capability withheld");
  }
  return { state: "queued" };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    console.log(JSON.stringify(await requestDeployment(process.env)));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
