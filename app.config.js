const { expo: productionConfig } = require('./app.json');

module.exports = function createExpoConfig() {
  const localDev = process.env.KF_LOCAL_DEV === '1';

  return {
    ...productionConfig,
    name: localDev ? 'KOLD Field Dev' : productionConfig.name,
    scheme: localDev ? 'kold-field-dev' : productionConfig.scheme,
    android: {
      ...productionConfig.android,
      package: localDev
        ? 'mx.grupofrio.koldfield.dev'
        : productionConfig.android.package,
    },
  };
};
