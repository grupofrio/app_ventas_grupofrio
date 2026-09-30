const KOLD_PUBLIC_ENV = new Set([
  'EXPO_PUBLIC_KF_DEFAULT_BASE_URL',
  'EXPO_PUBLIC_KF_ODOO_DB',
]);
const QA_PROFILE = 'qa-kold114';
const QA_TARGET_REPLACEMENTS = new Map([
  ['https://grupofrio-gf.odoo.com', 'EXPO_PUBLIC_KF_DEFAULT_BASE_URL'],
  ['grupofrio-gf-main-34980678', 'EXPO_PUBLIC_KF_ODOO_DB'],
]);

function inlineKoldPublicEnvironment({ types: t }) {
  function unwrapTypeScriptCast(node) {
    let current = node;
    while (t.isTSAsExpression(current) || t.isTSTypeAssertion(current)) {
      current = current.expression;
    }
    return current;
  }

  function isProcessEnv(node) {
    const candidate = unwrapTypeScriptCast(node);
    return t.isMemberExpression(candidate)
      && !candidate.computed
      && t.isIdentifier(candidate.object, { name: 'process' })
      && t.isIdentifier(candidate.property, { name: 'env' });
  }

  return {
    name: 'inline-kold-public-environment',
    visitor: {
      MemberExpression(path) {
        if (!path.node.computed || !isProcessEnv(path.node.object)) return;
        if (!t.isStringLiteral(path.node.property)) return;
        const key = path.node.property.value;
        if (!KOLD_PUBLIC_ENV.has(key)) return;
        path.replaceWith(t.valueToNode(process.env[key]));
      },
      StringLiteral(path) {
        if (process.env.EXPO_PUBLIC_BUILD_PROFILE !== QA_PROFILE) return;
        const replacementVariable = QA_TARGET_REPLACEMENTS.get(path.node.value);
        if (!replacementVariable) return;
        const replacement = process.env[replacementVariable];
        if (!replacement) {
          throw path.buildCodeFrameError(`${replacementVariable} is required for ${QA_PROFILE}`);
        }
        path.replaceWith(t.stringLiteral(replacement));
      },
    },
  };
}

module.exports = function configureBabel(api) {
  // These values differ per EAS profile. Disable Babel config caching so a
  // local QA export cannot reuse a production environment (or vice versa).
  api.cache(false);

  return {
    presets: ['babel-preset-expo'],
    plugins: [inlineKoldPublicEnvironment],
  };
};
