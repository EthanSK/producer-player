# Licensing scope and release policy

## Current source offer

Source-available under [Apache License 2.0 with Commons Clause v1.0](LICENSE). You may use and modify the covered software, including internally at work, and redistribute it under these terms. Commons Clause restricts selling products or services whose value derives entirely or substantially from the software's functionality; it does not prohibit every commercial use. Earlier licenses and third-party rights remain in force. See [scope and release policy](LICENSING.md).

The licensor is Ethan Sarif-Kattan, in his own capacity. This document does not
assert that any company owns his rights or that he owns another contributor's rights.
The offer combines the published Apache License 2.0 and Commons Clause License
Condition v1.0. The legal wording is unchanged; only the Commons Clause Software,
License and Licensor fields are completed. It is source-available, not
OSI-approved open source or unmodified Apache 2.0.

Commons Clause restricts a product or service sold for a fee or other
consideration when its value derives entirely or substantially from this
software's functionality. It does not prohibit every paid product using the
code; a product with sufficiently independent added value can be allowed.
The actual definition of Sell in LICENSE governs.

## Covered material and exclusions

The current offer covers only first-party code and documentation whose copyright
Ethan Sarif-Kattan owns or has authority to license. No ownership is inferred
merely from a repository name, a Git commit author, or an automated contribution.
Third-party libraries, copied code, dependencies, vendor SDKs, fonts, icons,
photographs, models, trademarks, data, and model weights keep their own terms.
Their notices must be retained, including for files distributed inside a build.
Generated output inherits any applicable source-material terms.

Repository-specific exclusions identified in this change:
- `ffmpeg-static` and its separately executed FFmpeg binary retain their GPL terms. Review corresponding-source and notice obligations for every shipped binary; this offer does not restrict their resale.
- Third-party audio plug-ins, SDKs, codecs and model assets retain their own licenses.

These exclusions are not an assertion that all other content is solely owned.
If additional third-party material or a co-owner is found, preserve their rights
and establish permission before applying a different license to that material.

## Earlier versions

On 2026-11-03, the current source offer changed from the custom Ethan
Source-Available No-Sale Terms 1.0 to Apache License 2.0 with Commons Clause
v1.0. The former offer is preserved verbatim at
[LICENSES/ethan-no-sale-1.0.txt](LICENSES/ethan-no-sale-1.0.txt).
Valid permissions already granted under it remain valid for the material they cover.

The audited pre-change source snapshot is
[`0e7f0839348150dd23739953d38eee1dfd8c27a9`](https://github.com/EthanSK/producer-player/tree/0e7f0839348150dd23739953d38eee1dfd8c27a9).
The previous root license is preserved verbatim at [LICENSES/prior-project-license.txt](LICENSES/prior-project-license.txt). All valid earlier licenses remain available for the material they cover,
including the right to sell under an earlier MIT grant where applicable.
Existing tags, releases and downloaded binaries have not been rewritten or
relicensed. The new terms apply only to the extent a recipient does not already
have an independent permission for the same material.

## Future contributions and releases

- Keep `LICENSE` and this scope document with distributed source and include
  them in the next binary or package release, alongside every applicable
  dependency license and notice. Do not retag or replace old release assets.
- Record the exact source commit, license version and exception list for a
  release. Do not call the combined product open source or promise exclusive
  commercial rights in previously licensed or third-party material.
- Before merging another person's contribution, record their express written
  permission for the proposed distribution and for any intended separate
  commercial licensing. A pull request or commit identity alone does not prove
  assignment or commercial relicensing consent. Until permission is recorded,
  retain the contributor's existing terms or keep the contribution separate.
- Before selling a combined build, review every shipped dependency, model,
  asset, and contributor grant. Copyleft components cannot be relicensed by
  placing this license next to them. Obtain the necessary permissions or
  keep those components under compatible separate terms.

## Published terms and provenance

The legal text comes from [Apache's official license](https://www.apache.org/licenses/LICENSE-2.0.txt)
and the [official Commons Clause v1.0 text](https://commonsclause.com/).
[Ethan's shared licensing guide](https://github.com/EthanSK/ethan-setup/tree/main/licensing)
keeps copies of both published texts and application instructions. This repository's
LICENSE completes only the three Commons Clause identification fields and then
includes Apache License 2.0 verbatim. No custom legal conditions are added.

The SHA-256 of this repository's current LICENSE is
`2758298dc3cc225ee07d0fdc9aee4fc2c2501e7f644323a3ce6e34ec482b3045`.
The scope notes here explain existing rights and exclusions; they do not amend
those published legal terms or establish ownership of third-party material.
