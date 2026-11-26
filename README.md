<table width="100%">
  <tr>
    <td align="left" width="120">
      <img src="https://assets.opencut.app/branding/symbol.svg" alt="OpenCut Logo" width="100" />
    </td>
    <td align="right">
      <h1>OpenCut</h1>
      <h3 style="margin-top: -10px;">A free and open source video editor for web, desktop, and mobile.</h3>
    </td>
  </tr>
</table>

[![Discord](https://img.shields.io/discord/1386309140057690133?label=Discord&logo=discord&logoColor=fff&color=5865F2&style=flat)](https://discord.gg/zmR9N35cjK)
[![X](https://img.shields.io/badge/follow-%40opencutapp-000?logo=x&logoColor=fff&style=flat)](https://x.com/opencutapp)
[![License: MIT](https://img.shields.io/badge/license-MIT-green?style=flat)](LICENSE)

## Status

**OpenCut is being rewritten from the ground up.** What's coming:

- An Editor API
- First-class third party plugins (made possible by a plugin-first architecture)
- Desktop, mobile, and browser from one codebase (Rust core)
- MCP server (for AI agents)
- Headless mode (automation, batch rendering)
- A scripting tab directly in the editor

You can still find the previous version at [opencut-app/opencut-classic](https://github.com/opencut-app/opencut-classic), which is the one to reach for today. [opencut.app](https://opencut.app) still runs the classic version. The rewrite will live at [new.opencut.app](https://new.opencut.app) until it's ready to take over.

## Development

Install [proto](https://moonrepo.dev/proto) if you haven't already:

**Linux, macOS, WSL:**

```sh
bash <(curl -fsSL https://moonrepo.dev/install/proto.sh)
```

**Windows (PowerShell):**

```powershell
irm https://moonrepo.dev/install/proto.ps1 | iex
```

If shims fail to run, allow local scripts for your user:

```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
```

From the repo root:

```sh
proto use    # installs the tools pinned in .prototools
```

```sh
moon run web:dev       # localhost:5173
moon run api:dev       # localhost:8787
moon run desktop:dev   # see apps/desktop/README.md
```

## Hosting the editor

The rewrite in `apps/` has no editor yet, so the editor we host is built from OpenCut classic, which lives in
`classic/` (a copy of [opencut-app/opencut-classic](https://github.com/opencut-app/opencut-classic) at `f1b45b4`,
plus the changes below). The `Dockerfile` at the repository root builds it:

```sh
docker build -t opencut-web .
```

```sh
docker run -d --name opencut-web -p 3000:3000 opencut-web
```

Open **http://localhost:3000/**. The image is one container on port **3000** with a health check at `/api/health`.
It runs without classic's database and Redis: those only serve sign-in, the feedback form and the sound search, so
the feedback button is gone from the editor and the sound search answers with an error.

What differs from classic:

- **No landing page.** `/` goes straight to the list of projects (`/projects`), and so does the logo.
- **Server copies** of what is made in the editor, described next.

### Keeping projects on the server

The editor keeps projects and media in the browser. The image can also keep a copy of every imported file, every
saved project and every export on the server. It is off until the container gets `OPENCUT_UPLOAD_SECRET` (at least
32 letters, digits, `_` or `-`), and it only works for a visitor whose page address carries a ticket that a server
knowing the same secret signed:

```
https://cut.example/projects?upload_user=<folder>&upload_exp=<unix time>&upload_sig=<signature>
```

`upload_sig` is the MD5 of `<upload_exp>:<upload_user>:<secret>` in base64url without padding; `upload_user` is
letters, digits, `.`, `_` and `-`, starting with a letter or digit. The site that embeds the editor makes the address
for its signed-in user. The editor then sends each file with `PUT /upload/<upload_user>/<project id>/<name>`, and the
server writes it under `OPENCUT_UPLOAD_DIR` (default `/mnt/sdc1/Rinku/OpenCut`); mount a volume there:

```sh
docker run -d --name opencut-web -p 3000:3000 \
  -e OPENCUT_UPLOAD_SECRET=... -v /mnt/sdc1/Rinku/OpenCut:/mnt/sdc1/Rinku/OpenCut opencut-web
```

Each project gets one folder, `<upload_user>/<project id>/`:

| File | What it is |
|---|---|
| `project.json` | The project as the editor saves it, replaced a few seconds after each save |
| `<media id>_<file name>` | An imported file, as it arrived; `project.json` refers to it by that media id |
| `export_<date>-<time>_<file name>` | An exported video |

The copies are one-way. The editor still opens projects from the browser, files can be written but not read back,
listed or deleted over HTTP, and deleting a project or a file in the editor leaves its copy on the server. One file
is at most 16 GB. A ticket for one folder doesn't open another, and stops working at `upload_exp`. A copy that fails
never stops a save: the editor says so once, and files and projects that did not arrive are sent again the next
time the project is opened. Without a ticket in the address nothing is sent.

The container starts as root so it can hand a host-mounted volume to the server, which runs as `nextjs`; on a volume
whose filesystem keeps no owners (FAT, exFAT, NTFS) the server runs as root instead.

To embed the editor in another site's frame, don't send `X-Frame-Options: DENY` or a `frame-ancestors` policy that
excludes that site from the proxy in front of it.

## Contributing

We're not set up to take outside contributions yet while the architecture is being designed. If you want to follow along, ask questions, or just hang out, [join the Discord](https://discord.gg/zmR9N35cjK) or [open an issue](https://github.com/opencut-app/opencut/issues).

## Sponsors

OpenCut is supported by companies that believe in open source creator tools.

- [**fal.ai**](https://fal.ai?utm_source=github-opencut&utm_campaign=oss): Generative image, video, and audio models all in one place.

Want your logo here? Reach out at [sponsor@opencut.app](mailto:sponsor@opencut.app).

## License

[MIT](LICENSE)
