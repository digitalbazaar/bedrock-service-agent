# bedrock-service-agent ChangeLog

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
