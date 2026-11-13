import { describe, expect, it, vi } from "vitest";
// @ts-expect-error Operator script uses plain JavaScript and no application types.
import { requestDeployment } from "../scripts/request-deployment.mjs";

const env = {
  GITHUB_EVENT_NAME: "push",
  GITHUB_REPOSITORY: "yogenpro/beanbag",
  GITHUB_REF: "refs/heads/main",
  GITHUB_SHA: "a".repeat(40),
  GITHUB_TOKEN: "synthetic-github-token",
  BEANBAG_DEPLOY_HOOK:
    "https://api.cloudflare.com/client/v4/workers/builds/deploy_hooks/00000000-0000-0000-0000-000000000000",
};
const head = (sha = env.GITHUB_SHA) => Response.json({ object: { sha } });

describe("checked main deployment requests", () => {
  it("checks main and sends no GitHub credential to Cloudflare", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(head())
      .mockResolvedValueOnce(
        Response.json({
          success: true,
          result: { build_uuid: "00000000-0000-0000-0000-000000000001" },
        }),
      );
    expect(await requestDeployment(env, request)).toEqual({ state: "queued" });
    expect(request.mock.calls[0][1].headers.Authorization).toBe(
      "Bearer synthetic-github-token",
    );
    expect(request.mock.calls[1][0]).toBe(env.BEANBAG_DEPLOY_HOOK);
    expect(request.mock.calls[1][1]).toMatchObject({
      method: "POST",
      redirect: "error",
    });
    expect(request.mock.calls[1][1].headers).toBeUndefined();
  });
  it.each([
    { GITHUB_EVENT_NAME: "pull_request" },
    { GITHUB_EVENT_NAME: "pull_request_target" },
    { GITHUB_REPOSITORY: "someone/beanbag" },
    { GITHUB_REF: "refs/heads/dev" },
    { GITHUB_REF: "refs/tags/v1" },
    { GITHUB_SHA: "unknown" },
    { BEANBAG_DEPLOY_HOOK: "https://example.invalid/hook" },
    { BEANBAG_DEPLOY_HOOK: "" },
  ])("rejects untrusted triggers or capabilities: %j", async (patch) => {
    const request = vi.fn();
    await expect(
      requestDeployment({ ...env, ...patch }, request),
    ).rejects.toThrow();
    expect(request).not.toHaveBeenCalled();
  });
  it("skips superseded commits", async () => {
    const request = vi.fn().mockResolvedValue(head("b".repeat(40)));
    expect(await requestDeployment(env, request)).toEqual({
      state: "superseded",
    });
    expect(request).toHaveBeenCalledTimes(1);
  });
  it("does not deploy when branch verification fails", async () => {
    const request = vi
      .fn()
      .mockResolvedValue(new Response("unavailable", { status: 503 }));
    await expect(requestDeployment(env, request)).rejects.toThrow(
      "Unable to verify",
    );
    expect(request).toHaveBeenCalledTimes(1);
  });
  it("redacts provider errors that contain the capability", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(head())
      .mockRejectedValueOnce(new Error(env.BEANBAG_DEPLOY_HOOK));
    await expect(requestDeployment(env, request)).rejects.toThrow(
      "Cloudflare build request failed; capability withheld",
    );
  });
  it("rejects a failed build result even with HTTP 200", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(head())
      .mockResolvedValueOnce(Response.json({ success: false }));
    await expect(requestDeployment(env, request)).rejects.toThrow(
      "Cloudflare build request failed; capability withheld",
    );
  });
});
