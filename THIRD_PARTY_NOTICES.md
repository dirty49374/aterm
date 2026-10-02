# Third-party notices

Aterm's original code and documentation use the Zero-Clause BSD License (0BSD).
That license does not replace the licenses of third-party components. No third-party
component is relicensed by this repository.

## Browser distributions

Core includes bundled browser dependencies. The build records the actual
transitive bundle inputs in `webapp/licenses/packages.json` and includes their
upstream LICENSE, COPYING, COPYRIGHT and NOTICE files beneath `webapp/licenses/`.
Linked `*.LEGAL.txt` files and existing per-library license files are retained.
Keep these files when redistributing built browser assets.

The main browser dependencies include React, React DOM, React Router, Mermaid,
markdown-it, markdown-it-task-lists, highlight.js, Cytoscape and its layout engines.
Most use MIT, ISC, BSD or Apache-2.0. khroma omits a license field in its manifest;
its included `license` file grants MIT. DOMPurify offers MPL-2.0 OR Apache-2.0;
Aterm uses the Apache-2.0 option.

### Eclipse Layout Kernel / elkjs

ELK is a separately licensed layout engine. Aterm uses the EPL-2.0 option offered
by elkjs, including versions whose metadata also offers GPL. Its license is
included as `webapp/elk-LICENSE.md` and in the generated license inventory. Aterm
copies the elkjs API and worker without modifying the upstream implementation;
ELK versions bundled transitively by Mermaid retain their own license as well.

Corresponding source and build instructions are available from:

- https://github.com/kieler/elkjs (select the release matching the inventory version)
- https://github.com/eclipse/elk (the underlying Eclipse Layout Kernel)
- https://www.eclipse.org/legal/epl-2.0/

Recipients may obtain, modify and redistribute the EPL-covered source under EPL-2.0.
Aterm's 0BSD license applies to its independent code, not to ELK. Preserve this
source-availability notice with binary distributions and keep the applicable
upstream source/release available when mirroring or redistributing the image.

## Installed runtime dependencies

npm installs Core/CLI dependencies separately. They are not relicensed or folded
into Aterm's source License. Preserve each installed package's notices, including
third-party notices inside native packages, in standalone installations.

| Component | Upstream license / source |
| --- | --- |
| Transformers.js and tokenizers | Apache-2.0; https://github.com/huggingface/transformers.js |
| ONNX Runtime | MIT plus included third-party notices; https://github.com/microsoft/onnxruntime |
| sharp | Apache-2.0; https://github.com/lovell/sharp |
| libvips and prebuilt sharp libraries | LGPL and other component-specific licenses; https://github.com/lovell/sharp-libvips and https://github.com/libvips/libvips |
| sqlite-vec | MIT or Apache; https://github.com/asg017/sqlite-vec |
| jq-wasm / jq | Wrapper and bundled components retain their licenses; https://github.com/jqlang/jq |
| GraphQL.js, MCP SDK, YAML, Zod and CLI utilities | See the installed packages' license files and manifests |

Native sharp/libvips packages include libraries under LGPL, MPL, BSD and other
licenses. Preserve their complete notices and corresponding source/build links.
They remain separately installed, replaceable libraries. No restriction is added
on reverse engineering needed to debug modifications to those libraries. Source
and packaging recipes are provided by the upstream projects linked above; their
licenses continue to govern those components in containers and standalone copies.
Model downloads are separate resources and retain their own model licenses.

## Development tools

Development-only dependencies are not shipped in the Aterm npm tarballs.
ESLint's SonarJS plugin uses LGPL-3.0; Lightning CSS uses MPL-2.0. These licenses
apply to those tools, not to code merely checked or built with them. Re-audit
licenses if a development tool is later bundled into a runtime distribution.
