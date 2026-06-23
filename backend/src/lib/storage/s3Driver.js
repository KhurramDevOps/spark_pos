// S3/object-storage driver — STUB (spec 006b / ADR-012). Not implemented until
// deploy time, when a provider + credentials are chosen. The interface IS the
// extension point: implementing put/delete/urlFor here and flipping
// STORAGE_DRIVER=s3 is a config change, not a rewrite of the upload pipeline.
const NOT_IMPL =
  'S3Driver is not implemented yet; set STORAGE_DRIVER=local for dev (spec 006b / ADR-012).';

export class S3Driver {
  // eslint-disable-next-line no-unused-vars
  async put(_buffer, _keyHint) {
    throw new Error(NOT_IMPL);
  }
  // eslint-disable-next-line no-unused-vars
  async delete(_key) {
    throw new Error(NOT_IMPL);
  }
  // eslint-disable-next-line no-unused-vars
  urlFor(_key) {
    throw new Error(NOT_IMPL);
  }
}
