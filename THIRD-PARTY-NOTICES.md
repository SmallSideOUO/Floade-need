# Floade remote distribution

Floade 0.1.22 integrates a modified RustDesk engine and is distributed under GNU AGPL version 3. See LICENSE. Floade code previously provided under MIT retains the permission and copyright notice in LICENSE-MIT.

RustDesk is copyright its contributors and Purslane Tech Pte. Ltd. The engine is based on RustDesk 1.5.0 and has changes to presentation scheduling, diagnostics, the local integration bridge, branding and the managed frontend. This is an independent Floade distribution.

Corresponding engine source and build scripts: https://github.com/SmallSideOUO/Floade-RustDesk

Floade application source: https://github.com/SmallSideOUO/Floade-need

Each release identifies the exact engine source revision in resources/remote/floade-build.json. Flutter, plugins and bundled native dependencies retain their respective licenses; the Flutter asset bundle includes its generated dependency notices. The pinned Flutter 3.24.5 engine source is https://github.com/rustdesk/engine/tree/bc374ca81eae3f77329ebf7bc98efadfde10018e.

The checksummed runtime also includes THIRD-PARTY-NATIVE-NOTICES.txt with the pinned Flutter Windows engine notices, vcpkg copyright files and Rust dependency licenses.

The application provides no warranty. You may copy, modify and redistribute the covered work under the AGPL terms. The remote settings window provides access to the license and source information.
