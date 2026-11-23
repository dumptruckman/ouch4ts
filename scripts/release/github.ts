import { z } from "zod";

export const assetSchema = z.object({ id: z.number(), name: z.string(), url: z.string(), browser_download_url: z.string() });
export const releaseSchema = z.object({
  id: z.number(), tag_name: z.string(), draft: z.boolean(), body: z.string().nullable(),
  target_commitish: z.string(), assets: z.array(assetSchema),
});
export type Release = z.infer<typeof releaseSchema>;
type ReleaseUpdate = Pick<Release, "body"> & Partial<Pick<Release, "target_commitish" | "draft">> & {
  prerelease?: boolean;
  make_latest?: "false";
};

export class GitHubError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export class GitHub {
  readonly options: { repository: string; token: string; api: string };

  constructor(options: GitHub["options"]) {
    this.options = options;
  }

  async request(method: string, endpoint: string, body?: unknown): Promise<unknown> {
    const response = await fetch(`${this.options.api}/repos/${this.options.repository}/${endpoint}`, {
      method,
      headers: { Authorization: `Bearer ${this.options.token}`, Accept: "application/vnd.github+json", "Content-Type": "application/json", "X-GitHub-Api-Version": "2022-11-28" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok) throw new GitHubError(response.status, `GitHub ${method} ${endpoint}: ${response.status} ${await response.text()}`);
    return response.status === 204 ? null : response.json();
  }

  async releases(): Promise<Release[]> {
    const releases: Release[] = [];
    for (let page = 1; ; page++) {
      const batch = z.array(releaseSchema).parse(await this.request("GET", `releases?per_page=100&page=${page}`));
      releases.push(...batch);
      if (batch.length < 100) return releases;
    }
  }

  async update(release: Release, changes: ReleaseUpdate): Promise<Release> {
    // GitHub can replace a draft's tag with an untagged-* placeholder on PATCH.
    return releaseSchema.parse(await this.request("PATCH", `releases/${release.id}`, { ...changes, tag_name: release.tag_name }));
  }

  async create(body: unknown): Promise<Release> {
    return releaseSchema.parse(await this.request("POST", "releases", body));
  }

  async asset(release: Release, name: string): Promise<Buffer | undefined> {
    const asset = release.assets.find((entry) => entry.name === name);
    if (!asset) return undefined;
    const response = await fetch(`${this.options.api}/repos/${this.options.repository}/releases/assets/${asset.id}`, {
      headers: { Authorization: `Bearer ${this.options.token}`, Accept: "application/octet-stream" },
    });
    if (!response.ok) throw new Error(`Cannot download ${name}: ${response.status}`);
    return Buffer.from(await response.arrayBuffer());
  }

  async upload(release: Release, name: string, bytes: Buffer): Promise<void> {
    const api = this.options.api === "https://api.github.com" ? "https://uploads.github.com" : this.options.api;
    const response = await fetch(`${api}/repos/${this.options.repository}/releases/${release.id}/assets?name=${encodeURIComponent(name)}`, {
      method: "POST", headers: { Authorization: `Bearer ${this.options.token}`, "Content-Type": "application/octet-stream" }, body: new Uint8Array(bytes),
    });
    if (!response.ok) throw new Error(`Cannot retain ${name}: ${response.status} ${await response.text()}`);
  }
}
