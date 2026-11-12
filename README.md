<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="src-tauri/icons/source/openidea-wordmark-dark.svg">
    <img src="src-tauri/icons/source/openidea-wordmark.svg" alt="OpenIDEA" height="56">
  </picture>
</p>

<p align="center">
  The IDE you know, rebuilt in Rust.
</p>

<p align="center">
  <a href="https://github.com/chaoluo-git/openidea/releases"><b>Download</b></a>
  &nbsp;·&nbsp;
  <a href="https://openidea.sh">Docs</a>
  &nbsp;·&nbsp;
  <a href="#benchmark">Benchmark</a>
  &nbsp;·&nbsp;
  <a href="#plugins">Plugins</a>
  &nbsp;·&nbsp;
  <a href="#community">Community</a>
  &nbsp;·&nbsp;
  <a href="#sponsor">Sponsor</a>
</p>

https://github.com/user-attachments/assets/234dd54c-1255-4b3a-b35c-533d78d737c0

This fork maintains the `dev` branch and publishes macOS Apple Silicon development
packages in [Releases](https://github.com/chaoluo-git/openidea/releases).
See [Maintained dev builds](CONTRIBUTING.md#maintained-dev-builds) for the build and release workflow.

OpenIDEA brings the IntelliJ IDEA way of working — its keymap, its tool windows,
its search-everything habits — to a native app with a Rust core.

Editor, code insight, debugger, Git, terminal, database and HTTP clients,
for 60+ languages. Builds for macOS, Windows and Linux.

## Review changed files

Double-click a file in **Commit → Changes** to open its diff over the full work
area. Use the toolbar arrows to move between differences or files; **Escape**
returns to the same Changes selection and commit draft. Restore or maximize the
viewer with its window controls. To keep comparisons in editor tabs, enable
**Settings → Version Control → Open Diff as Editor Tab**, or use a file's
**Show Diff in a New Tab** context action.

Unsaved edits remain available when you switch files or close the viewer. Save
and Save All still control disk writes when autosave is disabled; failed saves
keep the buffer available for retry.

## Generate commit messages with an agent

Select the files or code blocks to commit, then click **Generate** above the commit
message. It uses the provider and model of your recent agent session, or the agent
selected for a new task; configure and sign in under **Tools → Agents** first.
Repository instructions, recent commit subjects and the commit message line limits
guide the result. Included staged changes, partial hunks and Amend are supported.

Review or edit the generated draft before committing. **Cancel Commit Message
Generation** stops a pending request; editing the draft or changing the selected
changes while it runs preserves your newer work.

## Benchmark

Opening [freqtrade](https://github.com/freqtrade/freqtrade) (Python, ~770 files)
with warm caches, median of 5 runs:

|                             | OpenIDEA          | IntelliJ IDEA 2026.2.3 |
| --------------------------- | ----------------- | ---------------------- |
| Window with the project     | **0.9 s**         | 3.1 s                  |
| Ready (CPU settled)         | **1.1 s**         | 13.2 s                 |
| Memory (USS, all processes) | **169 MB**        | 2011 MB                |
| CPU time until ready        | **2.4 s**         | 47.9 s                 |
| Idle CPU                    | **4 %** of a core | 7 % of a core          |
| Quit                        | **0.3 s**         | 5.9 s                  |

A release build of OpenIDEA from `main` and IDEA with default settings and plugins, on
Windows 11, 32-core AMD, 62 GB RAM.
IDEA analyses Python more deeply, so "ready" doesn't mean the same work on
both sides. Both are measured from the outside, the same way: see
[`perf/compare`](perf/compare) to run it on your machine and projects.

## Plugins

Plugins add actions, completion, quick fixes, tool windows, custom editors,
themes, file icons and languages. They run as sandboxed WebAssembly components;
themes, icon themes and languages need no code at all.

Install them from Settings › Plugins, or start your own with
`openidea-plugin new` — see [Writing OpenIDEA plugins](https://openidea.sh/en/plugins) and
the [official plugins](plugins/official). The plugin API is still a preview.

## Community

- [Discord](https://discord.gg/2Zy4yn7gP) — questions, feedback and release news.
- WeChat group — scan to join:

  <img src=".github/assets/wechat-group.png" alt="WeChat group QR code" width="200">

- Contributing: see [CONTRIBUTING.md](CONTRIBUTING.md) and the [contributor docs](https://openidea.sh/en/contribute/setup).

## Sponsor

If OpenIDEA saves you time, you can support its development with Alipay or WeChat Pay.

<table>
  <tr>
    <td align="center"><img src=".github/assets/sponsor-alipay.png" alt="Alipay QR code" width="200"><br>Alipay</td>
    <td align="center"><img src=".github/assets/sponsor-wechat.png" alt="WeChat Pay QR code" width="200"><br>WeChat Pay</td>
  </tr>
</table>

## License

[Apache 2.0](LICENSE). Bundled third-party assets are listed in [`THIRD_PARTY_LICENSES.md`](THIRD_PARTY_LICENSES.md).

<sub>Not affiliated with JetBrains. IntelliJ IDEA is a trademark of JetBrains s.r.o.</sub>
