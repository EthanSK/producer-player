# Licensing scope and release policy

## Current source offer

Source-available under [Ethan Source-Available No-Sale Terms 1.0](LICENSE). You can use and modify the covered code, including internally at work, and share it without charge. Selling the software, modified versions, paid access, or bundles requires a separate commercial license. Earlier licenses and third-party rights remain in force. See [scope and release policy](LICENSING.md).

The licensor is Ethan Sarif-Kattan, in his own capacity. This document does not
assert that any company owns his rights or that he owns another contributor's rights.
The combined license uses the published PolyForm Noncommercial 1.0.0 template
with separately identified project-specific conditions and permissions. It must
not be described as unmodified PolyForm, MIT, or OSI-approved open source.

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

## Canonical terms

Version 1.0 is maintained at
[Ethan's setup](https://github.com/EthanSK/ethan-setup/blob/main/licensing/NO-SALE-TERMS.txt).
The root license in this repository is a copy of that version, with SHA-256
`31fa79f6d6b1387edcaff33c935aa8f992a2245cf645d7c86ceeb0c2f0c4ef75`.
A legal review of the project-specific conditions, contributor grants and the
planned commercial product is still required; use of a published base template
does not establish that the combined terms were reviewed by a solicitor.
