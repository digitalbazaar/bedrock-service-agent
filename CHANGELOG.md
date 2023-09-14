# bedrock-service-agent ChangeLog

## 8.0.0 - 2023-09-xx

### Changed
- **BREAKING**: Drop support for Node.js < 18.
- Use `@digitalbazaar/edv-client@16`. This version requires Node.js 18+.
- Use `@digitalbazaar/http-client@4`. This version requires Node.js 18+.

## 7.0.1 - 2023-08-27

### Fixed
- Fix unhandled promise rejection that could occur during ephemeral agent
  rotation.

## 7.0.0 - 2023-04-18

### Changed
- **BREAKING**: Update peerdep `@bedrock/did-io` to v10 that uses
  `@digitalbazaar/did-method-key@v5.0`. By default, `did:key` DIDs
  that use either Ed25519 or P-256 are now supported.

## 6.2.0 - 2022-11-13

### Changed
- Change dev mode default meter to work with `@bedrock/meter@5`.

## 6.1.0 - 2022-08-02

### Changed
- Use `@digitalbazaar/webkms-client@12`. Should be no
  external changes.

## 6.0.0 - 2022-06-30

### Changed
- **BREAKING**: Require Node.js >=16.
- Update dependencies.
- **BREAKING**: Update peer dependencies.
  - `@bedrock/app-identity@4`
  - `@bedrock/did-io@9`
- Test on Node.js 18.x.
- Use `package.json` `files` field.
- Lint module.

## 5.1.1 - 2022-05-18

### Fixed
- Fix cache value rotation code.

## 5.1.0 - 2022-05-09

### Added
- Add ephemeral agent to optimize invocation of service agent's zcaps.

## 5.0.0 - 2022-05-05

### Changed
- **BREAKING**: Use `@digitalbazaar/edv-client@14` with new blind
  attribute version. This version is incompatible with previous
  versions and a manual migration must be performed to update all
  EDV documents to use the new blind attribute version -- or a new
  deployment is required.

## 4.0.0 - 2022-04-29

### Changed
- **BREAKING**: Update peer deps:
  - `@bedrock/core@6`
  - `@bedrock/app-identity@3`
  - `@bedrock/did-context@4`
  - `@bedrock/did-io@8`
  - `@bedrock/express@8`
  - `@bedrock/https-agent@4`
  - `@bedrock/jsonld-document-loader@3`
  - `@bedrock/mongodb@10`
  - `@bedrock/security-context@7`
  - `@bedrock/veres-one-context@14`.

## 3.0.0 - 2022-04-05

### Changed
- **BREAKING**: Rename package to `@bedrock/service-agent`.
- **BREAKING**: Convert to module (ESM).
- **BREAKING**: Remove default export.
- **BREAKING**: Require node 14.x.

## 2.0.0 - 2022-03-01

### Changed
- **BREAKING**: Use `@digitalbazaar/webkms-client@10` and
  `@digitalbazaar/edv-client@13`.
- **BREAKING**: Move zcap revocations to `/zcaps/revocations` in
  test suite to better future proof.

## 1.0.1 - 2022-02-24

### Fixed
- Fix `ensureConfigOverride` for `service-agent.kms.kmsModule`.

## 1.0.0 - 2022-02-20

- See git history for changes.
