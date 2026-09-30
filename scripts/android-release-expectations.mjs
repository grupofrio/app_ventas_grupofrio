export const ANDROID_RELEASE_EXPECTATIONS = Object.freeze({
  'mx.grupofrio.koldfield': Object.freeze({
    certificateSha256: 'c18ac1fab03b839e4e4c25fcedd99d59e16927b593a0e292cfd880287bd6f08c',
  }),
  'mx.grupofrio.koldfield.dev': Object.freeze({
    certificateSha256: '3b536a000d4dc09b77fd7704a535df506cdc33443dc7e80a7c4428b1f1369e54',
  }),
});

export function expectedAndroidCertificate(applicationId) {
  const expected = ANDROID_RELEASE_EXPECTATIONS[applicationId];
  if (!expected) {
    throw new Error(`No hay una credencial Android autorizada para ${applicationId}.`);
  }
  return expected.certificateSha256;
}
