import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';

const exchange = readFileSync(
  resolve(process.cwd(), 'app/exchange/[stopId].tsx'),
  'utf8',
);
const syncStore = readFileSync(
  resolve(process.cwd(), 'src/stores/useSyncStore.ts'),
  'utf8',
);

const sourceFile = ts.createSourceFile(
  'exchange.tsx',
  exchange,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
const syntaxNodes = [];
const syncSourceFile = ts.createSourceFile(
  'useSyncStore.ts',
  syncStore,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TS,
);
const syncSyntaxNodes = [];

function collectSyntaxNodes(node) {
  syntaxNodes.push(node);
  ts.forEachChild(node, collectSyntaxNodes);
}

collectSyntaxNodes(sourceFile);
function collectSyncSyntaxNodes(node) {
  syncSyntaxNodes.push(node);
  ts.forEachChild(node, collectSyncSyntaxNodes);
}

collectSyncSyntaxNodes(syncSourceFile);

function blockBody(block) {
  const openBraceIndex = block.getStart(sourceFile);
  const closeBraceIndex = block.end - 1;
  assert.equal(exchange[openBraceIndex], '{', 'el AST debe localizar la llave inicial');
  assert.equal(exchange[closeBraceIndex], '}', 'el AST debe localizar la llave final');
  return exchange.slice(openBraceIndex + 1, closeBraceIndex);
}

function tryCatchContaining(needle) {
  const needleIndex = exchange.indexOf(needle);
  assert.notEqual(needleIndex, -1, `no se encontro la operacion: ${needle}`);

  const statement = syntaxNodes
    .filter(ts.isTryStatement)
    .filter((candidate) => (
      candidate.tryBlock.getStart(sourceFile) < needleIndex
      && needleIndex < candidate.tryBlock.end
    ))
    .sort((left, right) => (
      right.tryBlock.getStart(sourceFile) - left.tryBlock.getStart(sourceFile)
    ))[0];

  assert(statement, `${needle} debe estar dentro de un try`);
  assert(statement.catchClause, `el try de ${needle} debe tener catch`);

  return {
    statement,
    catchBlock: statement.catchClause.block,
    catchBody: blockBody(statement.catchClause.block),
  };
}

function nodeText(node) {
  return exchange.slice(node.getStart(sourceFile), node.end);
}

function namedFunctionBodies() {
  return syntaxNodes.flatMap((node) => {
    if (ts.isFunctionDeclaration(node) && node.name && node.body) {
      return [{
        name: node.name.text,
        bodyNode: node.body,
        body: nodeText(node.body),
      }];
    }

    if (
      ts.isVariableDeclaration(node)
      && ts.isIdentifier(node.name)
      && node.initializer
      && (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))
      && node.initializer.body
    ) {
      return [{
        name: node.name.text,
        bodyNode: node.initializer.body,
        body: nodeText(node.initializer.body),
      }];
    }

    return [];
  });
}

function routerReplaceForPath(bodyNode, path) {
  const bodyStart = bodyNode.getStart(sourceFile);
  return syntaxNodes
    .filter(ts.isCallExpression)
    .filter((call) => {
      if (call.getStart(sourceFile) < bodyStart || call.end > bodyNode.end) return false;
      if (!ts.isPropertyAccessExpression(call.expression)) return false;
      return (
        call.expression.name.text === 'replace'
        && call.expression.expression.getText(sourceFile) === 'router'
        && nodeText(call).includes(path)
      );
    })[0];
}

function photoMapCalls() {
  return syntaxNodes
    .filter(ts.isCallExpression)
    .filter((call) => {
      if (!ts.isPropertyAccessExpression(call.expression)) return false;
      if (call.expression.name.text !== 'map') return false;
      return call.expression.expression.getText(sourceFile) === 'photoUris';
    });
}

function isAwaited(call) {
  return Boolean(call.parent && ts.isAwaitExpression(call.parent));
}

function nodesInBody(bodyNode, predicate) {
  const bodyStart = bodyNode.getStart(sourceFile);
  return syntaxNodes.filter((node) => (
    predicate(node)
    && node.getStart(sourceFile) >= bodyStart
    && node.end <= bodyNode.end
  ));
}

function hasNestedFunctionBetween(node, bodyNode) {
  let current = node.parent;
  while (current && current !== bodyNode) {
    if (isFunctionLikeNode(current)) return true;
    current = current.parent;
  }
  return false;
}

function directNodesInBody(bodyNode, predicate) {
  return nodesInBody(bodyNode, predicate)
    .filter((node) => !hasNestedFunctionBetween(node, bodyNode));
}

function directCallsInBody(bodyNode, functionName) {
  return directNodesInBody(bodyNode, ts.isCallExpression)
    .filter((call) => (
      ts.isIdentifier(call.expression) && call.expression.text === functionName
    ));
}

function variableBindsCall(bodyNode, variableName, call) {
  return nodesInBody(bodyNode, ts.isVariableDeclaration).some((declaration) => (
    declaration.name.getText(sourceFile) === variableName
    && declaration.initializer
    && call.getStart(sourceFile) >= declaration.initializer.getStart(sourceFile)
    && call.end <= declaration.initializer.end
  ));
}

function isFunctionLikeNode(node) {
  return (
    ts.isArrowFunction(node)
    || ts.isFunctionExpression(node)
    || ts.isFunctionDeclaration(node)
    || ts.isMethodDeclaration(node)
  );
}

function isControlFlowWrapper(node) {
  return (
    ts.isIfStatement(node)
    || ts.isForStatement(node)
    || ts.isForInStatement(node)
    || ts.isForOfStatement(node)
    || ts.isWhileStatement(node)
    || ts.isDoStatement(node)
    || ts.isSwitchStatement(node)
    || ts.isConditionalExpression(node)
  );
}

function isTopLevelPostCreateCall(call, scopeBody, createStatement) {
  if (call.getStart(sourceFile) <= createStatement.end) return false;

  let current = call.parent;
  while (current && current !== scopeBody) {
    if (isFunctionLikeNode(current) || isControlFlowWrapper(current)) return false;
    if (ts.isCatchClause(current)) return false;
    if (
      ts.isBlock(current)
      && ts.isTryStatement(current.parent)
      && current.parent.finallyBlock === current
    ) return false;
    if (
      !ts.isAwaitExpression(current)
      && !ts.isExpressionStatement(current)
      && !ts.isBlock(current)
      && !ts.isTryStatement(current)
    ) return false;
    current = current.parent;
  }
  return current === scopeBody;
}

function enclosingTryStatements(call) {
  const tries = [];
  let current = call.parent;
  while (current) {
    if (ts.isTryStatement(current)) tries.push(current);
    current = current.parent;
  }
  return tries;
}

function commonTryStatement(calls) {
  if (calls.length === 0) return null;
  return enclosingTryStatements(calls[0]).find((candidate) => calls.every((call) => (
    call.getStart(sourceFile) >= candidate.tryBlock.getStart(sourceFile)
    && call.end <= candidate.tryBlock.end
  )));
}

function objectProperty(object, name) {
  return object.properties.find((property) => (
    property.name?.getText(sourceFile) === name
  ));
}

function propertyValueText(property) {
  return property.initializer
    ? property.initializer.getText(sourceFile)
    : property.name?.getText(sourceFile);
}

function returnedExpression(functionNode) {
  if (!ts.isBlock(functionNode.body)) return functionNode.body;
  return functionNode.body.statements
    .filter(ts.isReturnStatement)
    .map((statement) => statement.expression)
    .find(Boolean);
}

function isPhotoLocalUri(node) {
  return (
    ts.isPropertyAccessExpression(node)
    && node.expression.getText(sourceFile) === 'photo'
    && node.name.text === 'localUri'
  );
}

function isPhotoAppendSetterCall(call) {
  const argument = call.arguments[0];
  if (!argument) return false;

  if (ts.isArrayLiteralExpression(argument)) {
    return argument.elements.some((element) => (
      ts.isSpreadElement(element) && element.expression.getText(sourceFile) === 'photoUris'
    )) && argument.elements.some((element) => isPhotoLocalUri(element));
  }

  if (!ts.isArrowFunction(argument) && !ts.isFunctionExpression(argument)) return false;
  const parameter = argument.parameters[0]?.name?.getText(sourceFile);
  const expression = returnedExpression(argument);
  if (!parameter || !expression) return false;

  if (ts.isArrayLiteralExpression(expression)) {
    return expression.elements.some((element) => (
      ts.isSpreadElement(element) && element.expression.getText(sourceFile) === parameter
    )) && expression.elements.some((element) => isPhotoLocalUri(element));
  }

  return (
    ts.isCallExpression(expression)
    && ts.isPropertyAccessExpression(expression.expression)
    && expression.expression.name.text === 'concat'
    && expression.expression.expression.getText(sourceFile) === parameter
    && expression.arguments.some((element) => isPhotoLocalUri(element))
  );
}

function isUriRemovalPredicate(predicate) {
  const expression = returnedExpression(predicate);
  return (
    expression
    && ts.isBinaryExpression(expression)
    && (expression.operatorToken.kind === ts.SyntaxKind.ExclamationEqualsToken
      || expression.operatorToken.kind === ts.SyntaxKind.ExclamationEqualsEqualsToken)
    && expression.right.getText(sourceFile) === 'uri'
  );
}

function isPhotoRemovalSetterCall(call) {
  const argument = call.arguments[0];
  if (!argument) return false;

  if (ts.isArrowFunction(argument) || ts.isFunctionExpression(argument)) {
    const currentArray = argument.parameters[0]?.name?.getText(sourceFile);
    if (!currentArray) return false;
    const filterCalls = ts.isBlock(argument.body)
      ? nodesInBody(argument.body, ts.isCallExpression)
      : [argument.body];
    return filterCalls.some((filterCall) => (
      ts.isCallExpression(filterCall)
      && ts.isPropertyAccessExpression(filterCall.expression)
      && filterCall.expression.name.text === 'filter'
      && filterCall.expression.expression.getText(sourceFile) === currentArray
      && filterCall.arguments[0]
      && (ts.isArrowFunction(filterCall.arguments[0]) || ts.isFunctionExpression(filterCall.arguments[0]))
      && isUriRemovalPredicate(filterCall.arguments[0])
    ));
  }

  return (
    ts.isCallExpression(argument)
    && ts.isPropertyAccessExpression(argument.expression)
    && argument.expression.name.text === 'filter'
    && argument.expression.expression.getText(sourceFile) === 'photoUris'
    && argument.arguments[0]
    && (ts.isArrowFunction(argument.arguments[0]) || ts.isFunctionExpression(argument.arguments[0]))
    && isUriRemovalPredicate(argument.arguments[0])
  );
}

function jsxTagName(node) {
  if (ts.isJsxSelfClosingElement(node)) return node.tagName.getText(sourceFile);
  if (ts.isJsxElement(node)) return node.openingElement.tagName.getText(sourceFile);
  return null;
}

function onPressAttributesForTag(tagNames) {
  return syntaxNodes
    .filter(ts.isJsxAttribute)
    .filter((attribute) => attribute.name.text === 'onPress')
    .flatMap((attribute) => {
      let owner = attribute.parent;
      while (
        owner
        && !ts.isJsxSelfClosingElement(owner)
        && !ts.isJsxElement(owner)
      ) {
        owner = owner.parent;
      }
      if (!owner || !tagNames.includes(jsxTagName(owner))) return [];
      return [{ attribute, owner }];
  });
}

function jsxAttributes(node) {
  if (ts.isJsxSelfClosingElement(node)) return node.attributes.properties;
  if (ts.isJsxElement(node)) return node.openingElement.attributes.properties;
  return [];
}

function isAlertCallExpression(expression) {
  return (
    ts.isCallExpression(expression)
    && ts.isPropertyAccessExpression(expression.expression)
    && expression.expression.expression.getText(sourceFile) === 'Alert'
    && expression.expression.name.text === 'alert'
  );
}

function directAlertStatements(block) {
  return block.statements.filter((statement) => (
    ts.isExpressionStatement(statement) && isAlertCallExpression(statement.expression)
  ));
}

function directStatements(statement) {
  return ts.isBlock(statement) ? statement.statements : [statement];
}

function hasZeroPhotoPredicate(expression) {
  return /photoUris\.length\s*(?:===\s*0|<\s*1)|!\s*photoUris\.length/.test(
    expression.getText(sourceFile),
  );
}

function unwrapParentheses(expression) {
  let current = expression;
  while (ts.isParenthesizedExpression(current)) current = current.expression;
  return current;
}

function isPhotoUrisLength(expression) {
  const unwrapped = unwrapParentheses(expression);
  return (
    ts.isPropertyAccessExpression(unwrapped)
    && unwrapped.expression.getText(sourceFile) === 'photoUris'
    && unwrapped.name.text === 'length'
  );
}

function isExactZeroPhotoPredicate(expression) {
  const unwrapped = unwrapParentheses(expression);
  if (
    ts.isPrefixUnaryExpression(unwrapped)
    && unwrapped.operator === ts.SyntaxKind.ExclamationToken
  ) {
    return isPhotoUrisLength(unwrapped.operand);
  }
  return (
    ts.isBinaryExpression(unwrapped)
    && unwrapped.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken
    && isPhotoUrisLength(unwrapped.left)
    && ts.isNumericLiteral(unwrapParentheses(unwrapped.right))
    && unwrapParentheses(unwrapped.right).text === '0'
  );
}

function isSavingReference(expression) {
  return unwrapParentheses(expression).getText(sourceFile) === 'saving';
}

function isSavingOrExactlyZeroPhotos(expression) {
  const unwrapped = unwrapParentheses(expression);
  if (
    !ts.isBinaryExpression(unwrapped)
    || unwrapped.operatorToken.kind !== ts.SyntaxKind.BarBarToken
  ) return false;
  return (
    (isSavingReference(unwrapped.left) && isExactZeroPhotoPredicate(unwrapped.right))
    || (isExactZeroPhotoPredicate(unwrapped.left) && isSavingReference(unwrapped.right))
  );
}

function nodeContains(container, node) {
  return (
    node.getStart(sourceFile) >= container.getStart(sourceFile)
    && node.end <= container.end
  );
}

function acceptsCapturedPhoto(expression) {
  return /^(?:photo|photo\s*!={1,2}\s*null|photo\s*!={1,2}\s*undefined)$/.test(
    expression.getText(sourceFile).trim(),
  );
}

function rejectsCapturedPhoto(expression) {
  return /^(?:!\s*photo|photo\s*={2,3}\s*(?:null|undefined))$/.test(
    expression.getText(sourceFile).trim(),
  );
}

function hasDirectTerminalStatement(statement) {
  return directStatements(statement).some((candidate) => (
    ts.isReturnStatement(candidate) || ts.isThrowStatement(candidate)
  ));
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const captureHandler = namedFunctionBodies()
  .find(({ name }) => name === 'handleAddExchangePhoto');
assert(captureHandler, 'debe existir el handler nombrado handleAddExchangePhoto');
const captureTakePhotoCalls = directCallsInBody(captureHandler.bodyNode, 'takePhoto');
const captureSetterCalls = directCallsInBody(captureHandler.bodyNode, 'setPhotoUris');
const captureResultChecks = directNodesInBody(captureHandler.bodyNode, ts.isIfStatement).filter((statement) => (
    /\bphoto\b/.test(statement.expression.getText(sourceFile))
));
assert.equal(captureTakePhotoCalls.length, 1, 'el handler debe invocar takePhoto una vez');
const captureTakePhotoCall = captureTakePhotoCalls[0];
assert(
  isAwaited(captureTakePhotoCall),
  'takePhoto debe esperarse antes de procesar la captura',
);
assert(
  variableBindsCall(captureHandler.bodyNode, 'photo', captureTakePhotoCall),
  'el resultado de takePhoto debe quedar ligado a la variable photo',
);
assert(
  captureResultChecks.length > 0,
  'el handler debe comprobar si la captura produjo una foto',
);
const captureAppendCall = captureSetterCalls.find((call) => isPhotoAppendSetterCall(call));
assert(
  captureAppendCall,
  'el setter debe conservar las URI previas y agregar photo.localUri en su argumento real',
);
const acceptedPhotoGuard = captureResultChecks.find((statement) => (
  acceptsCapturedPhoto(statement.expression)
  && nodeContains(statement.thenStatement, captureAppendCall)
));
const rejectedPhotoGuard = captureResultChecks.find((statement) => (
  rejectsCapturedPhoto(statement.expression)
  && captureAppendCall.getStart(sourceFile) > statement.end
  && hasDirectTerminalStatement(statement.thenStatement)
));
assert(
  acceptedPhotoGuard || rejectedPhotoGuard,
  'la captura debe agregar la URI solo en una rama que confirme la foto o después de un retorno nulo directo',
);
if (acceptedPhotoGuard) {
  assert(
    acceptedPhotoGuard.elseStatement
      && /Foto requerida/.test(nodeText(acceptedPhotoGuard.elseStatement)),
    'la rama de captura fallida debe mostrar el copy Foto requerida',
  );
} else {
  assert.match(
    nodeText(rejectedPhotoGuard.thenStatement),
    /Foto requerida/,
    'la rama que rechaza una captura nula debe mostrar el copy Foto requerida',
  );
}
assert(
  captureAppendCall.getStart(sourceFile) > captureTakePhotoCall.end,
  'el setter de captura debe ejecutarse después de takePhoto',
);
assert.match(
  exchange,
  /import\s*\{[^}]*\btakePhoto\b[^}]*\}\s*from\s*['"]\.\.\/\.\.\/src\/services\/camera['"]/,
  'la pantalla debe usar la cámara existente',
);
const captureWiring = onPressAttributesForTag(['Button', 'TouchableOpacity'])
  .find(({ attribute, owner }) => (
    new RegExp(`\\b${escapeRegExp(captureHandler.name)}\\b`).test(nodeText(attribute))
    && /Tomar foto|Agregar otra foto/.test(nodeText(owner))
  ));
assert(
  captureWiring,
  'handleAddExchangePhoto debe estar en el onPress del CTA Tomar foto o Agregar otra foto',
);

const removalHandler = namedFunctionBodies()
  .filter(({ name }) => /photo/i.test(name))
  .find(({ bodyNode }) => (
    directCallsInBody(bodyNode, 'deletePhoto').some((call) => (
    call.arguments[0]?.getText(sourceFile) === 'uri'
    ))
    && directCallsInBody(bodyNode, 'setPhotoUris').some((call) => isPhotoRemovalSetterCall(call))
  ));
assert(removalHandler, 'el handler de eliminación debe borrar la URI seleccionada del estado');
assert(
  directCallsInBody(removalHandler.bodyNode, 'deletePhoto')
    .some((call) => call.arguments[0]?.getText(sourceFile) === 'uri'),
  'el handler debe borrar el archivo de la URI seleccionada',
);
assert(
  directCallsInBody(removalHandler.bodyNode, 'setPhotoUris')
    .some((call) => isPhotoRemovalSetterCall(call)),
  'el setter debe filtrar la misma URI seleccionada desde el arreglo actual',
);
assert.match(
  exchange,
  /import\s*\{[^}]*\bdeletePhoto\b[^}]*\}\s*from\s*['"]\.\.\/\.\.\/src\/services\/camera['"]/,
  'la pantalla debe importar deletePhoto para limpiar capturas locales',
);

const photoMap = photoMapCalls().find((call) => {
  const mapper = call.arguments[0];
  return (
    (ts.isArrowFunction(mapper) || ts.isFunctionExpression(mapper))
    && mapper.parameters[0]?.name?.getText(sourceFile) === 'uri'
  );
});
assert(photoMap, 'las evidencias deben renderizarse desde photoUris.map con la URI seleccionada');
const photoMapBody = photoMap.arguments[0].body;
const photoRemovePress = nodesInBody(photoMapBody, ts.isJsxAttribute)
  .find((attribute) => (
    attribute.name.text === 'onPress'
    && new RegExp(`${escapeRegExp(removalHandler.name)}\\s*\\(\\s*uri\\s*\\)`)
      .test(nodeText(attribute))
  ));
assert(
  photoRemovePress
    && /(?:label\s*=\s*['"]Eliminar['"]|>\s*Eliminar\s*<)/.test(nodeText(photoMapBody)),
  'la UI de photoUris debe mostrar Eliminar y pasar la URI seleccionada al handler fotográfico',
);

assert.match(
  exchange,
  /const\s*\[\s*photoUris\s*,\s*setPhotoUris\s*\]\s*=\s*useState<\s*string\[\]\s*>\s*\(\s*\[\]\s*\)/,
  'la pantalla debe conservar las URI de evidencia en un arreglo de estado',
);
assert.match(exchange, /Agregar otra foto/, 'la UI debe permitir agregar otra foto');

const submitHandler = namedFunctionBodies().find(({ name }) => name === 'handleSubmit');
assert(submitHandler, 'la pantalla debe tener un handler nombrado handleSubmit');
const firstSubmitStatement = submitHandler.bodyNode.statements[0];
assert(
  firstSubmitStatement
    && ts.isIfStatement(firstSubmitStatement)
    && /\bsaving\b/.test(firstSubmitStatement.expression.getText(sourceFile))
    && directStatements(firstSubmitStatement.thenStatement).some((statement) => (
      ts.isReturnStatement(statement)
    )),
  'handleSubmit debe comenzar con un guard saving que retorna temprano',
);
const createExchangeCalls = nodesInBody(submitHandler.bodyNode, ts.isCallExpression)
  .filter((call) => (
    ts.isIdentifier(call.expression) && call.expression.text === 'createExchange'
  ));
assert.equal(
  createExchangeCalls.length,
  1,
  'handleSubmit debe invocar createExchange exactamente una vez',
);
const registrationButton = syntaxNodes
  .filter((node) => ts.isJsxSelfClosingElement(node) || ts.isJsxElement(node))
  .map((node) => ({ node, body: nodeText(node) }))
  .find(({ node, body }) => (
    jsxTagName(node) === 'Button' && /Registrar Cambio/.test(body)
  ));
assert(registrationButton, 'debe existir el Button de Registrar Cambio');
const registrationOnPress = jsxAttributes(registrationButton.node)
  .find((attribute) => attribute.name.text === 'onPress');
assert(
  registrationOnPress
    && registrationOnPress.initializer
    && ts.isJsxExpression(registrationOnPress.initializer)
    && registrationOnPress.initializer.expression
    && /\bhandleSubmit\b/.test(
      registrationOnPress.initializer.expression.getText(sourceFile),
    ),
  'el onPress del Button Registrar Cambio debe invocar o envolver handleSubmit',
);

const createPhase = tryCatchContaining('response = await createExchange({');
assert.equal(
  createPhase.statement.parent,
  submitHandler.bodyNode,
  'el TryStatement de createExchange debe ser una sentencia directa de handleSubmit',
);
const zeroPhotoGuards = directNodesInBody(submitHandler.bodyNode, ts.isIfStatement)
  .filter((statement) => hasZeroPhotoPredicate(statement.expression));
const zeroPhotoGuard = zeroPhotoGuards.find((statement) => {
  const directThenStatements = directStatements(statement.thenStatement);
  const alert = directThenStatements.find((candidate) => (
    ts.isExpressionStatement(candidate) && isAlertCallExpression(candidate.expression)
  ));
  const terminal = directThenStatements.some((candidate) => (
    ts.isReturnStatement(candidate) || ts.isThrowStatement(candidate)
  ));
  return (
    (alert || terminal)
    && /Evidencia del cambio|Evidencia requerida|Foto requerida|foto[^\n]{0,40}obligatoria/i.test(
      directThenStatements.map((candidate) => nodeText(candidate)).join('\n'),
    )
  );
});
const registrationDisabled = jsxAttributes(registrationButton.node)
  .find((attribute) => attribute.name.text === 'disabled');
const registrationDisabledExpression = registrationDisabled
  && registrationDisabled.initializer
  && ts.isJsxExpression(registrationDisabled.initializer)
  && registrationDisabled.initializer.expression;
const registrationDisabledHasSavingAndExactZeroPredicate = registrationDisabledExpression
  && isSavingOrExactlyZeroPhotos(registrationDisabledExpression);
assert(
  zeroPhotoGuard,
  'handleSubmit debe validar las fotos con un predicado real de cero fotos',
);
assert(
  zeroPhotoGuard.getStart(sourceFile) < createPhase.statement.getStart(sourceFile),
  'el guard de cero fotos debe ocurrir antes de llamar a createExchange',
);
assert(
  registrationDisabledHasSavingAndExactZeroPredicate,
  'el Button real de Registrar Cambio debe deshabilitarse con saving || photoUris.length === 0',
);
const directThenStatements = directStatements(zeroPhotoGuard.thenStatement);
assert(
  directThenStatements.some((candidate) => (
    ts.isExpressionStatement(candidate) && isAlertCallExpression(candidate.expression)
  )) || directThenStatements.some((candidate) => (
    ts.isReturnStatement(candidate) || ts.isThrowStatement(candidate)
  )),
  'el guard de cero fotos debe terminar con Alert.alert o return/throw directo',
);

assert.match(
  createPhase.catchBody,
  /setSaving\s*\(\s*false\s*\)/,
  'el catch de createExchange debe liberar el estado de guardado',
);
const createCatchStatements = createPhase.catchBlock.statements;
const createCatchLastStatement = createCatchStatements[createCatchStatements.length - 1];
assert(
  createCatchLastStatement
    && (ts.isReturnStatement(createCatchLastStatement) || ts.isThrowStatement(createCatchLastStatement)),
  'el catch de createExchange debe terminar con return o throw directo',
);
assert.doesNotMatch(
  createPhase.catchBody,
  /enqueueVisitPhotos|await\s+persistQueue\s*\(\s*\)/,
  'el catch de createExchange no debe encolar ni persistir fotos',
);

assert.match(
  exchange,
  /import\s*\{\s*enqueueVisitPhotos\s*\}\s*from\s*['"]\.\.\/\.\.\/src\/services\/visitPhotos['"]/,
  'la pantalla debe reutilizar el helper de fotos de visita',
);
assert.match(
  exchange,
  /const\s+enqueue\s*=\s*useSyncStore\(\s*\(\s*\w+\s*\)\s*=>\s*\w+\.enqueue\s*\)/,
  'la pantalla debe seleccionar enqueue desde useSyncStore',
);
assert.match(
  exchange,
  /const\s+persistQueue\s*=\s*useSyncStore\(\s*\(\s*\w+\s*\)\s*=>\s*\w+\.persistQueue\s*\)/,
  'la pantalla debe seleccionar persistQueue desde useSyncStore',
);

const enqueueCalls = directCallsInBody(submitHandler.bodyNode, 'enqueueVisitPhotos');
assert.equal(enqueueCalls.length, 1, 'el submit debe tener una llamada de encolado post-éxito');
const enqueueCall = enqueueCalls[0];
const enqueueObject = enqueueCall.arguments[0];
assert(
  enqueueObject && ts.isObjectLiteralExpression(enqueueObject),
  'enqueueVisitPhotos debe recibir un objeto de configuración',
);
const enqueueProperties = enqueueObject.properties
  .map((property) => property.name?.getText(sourceFile))
  .filter(Boolean);
const stopIdProperty = objectProperty(enqueueObject, 'stopId');
const photoUrisProperty = objectProperty(enqueueObject, 'photoUris');
const enqueueProperty = objectProperty(enqueueObject, 'enqueue');
const imageTypeProperty = objectProperty(enqueueObject, 'imageType');
assert(stopIdProperty, 'la llamada de encolado debe incluir stopId');
assert(photoUrisProperty, 'la llamada de encolado debe incluir photoUris');
assert(enqueueProperty, 'la llamada de encolado debe incluir la función enqueue');
assert(imageTypeProperty, 'la llamada de encolado debe incluir imageType');
assert.equal(propertyValueText(stopIdProperty), 'currentStop.id');
assert.equal(propertyValueText(photoUrisProperty), 'photoUris');
assert.equal(propertyValueText(enqueueProperty), 'enqueue');
assert.equal(
  propertyValueText(imageTypeProperty).replace(/^['"]|['"]$/g, ''),
  'exchange',
);
assert(
  !enqueueProperties.includes('dependsOn'),
  'la evidencia del cambio no debe declarar dependsOn',
);
assert(
  !enqueueProperties.includes('image_base64'),
  'la evidencia del cambio no debe declarar image_base64 en la cola',
);

const persistCalls = directCallsInBody(submitHandler.bodyNode, 'persistQueue');
assert.equal(persistCalls.length, 1, 'el submit debe persistir la cola una vez después de encolar');
const persistCall = persistCalls[0];
assert(isAwaited(persistCall), 'persistQueue debe esperarse después de encolar las fotos');

const saveCalls = directCallsInBody(submitHandler.bodyNode, 'saveExchangeTicketSnapshot')
  .filter((call) => call.arguments[0]?.getText(sourceFile) === 'snapshot');
assert.equal(saveCalls.length, 1, 'el submit debe guardar el snapshot del cambio una vez');
const saveCall = saveCalls[0];
assert(isAwaited(saveCall), 'saveExchangeTicketSnapshot(snapshot) debe esperarse');

const printRouteCall = routerReplaceForPath(
  submitHandler.bodyNode,
  '/print-exchange/[snapshotId]',
);
assert(printRouteCall, 'el submit debe navegar al ticket de cambio después de preparar la evidencia');

for (const [label, call] of [
  ['enqueueVisitPhotos', enqueueCall],
  ['persistQueue', persistCall],
  ['saveExchangeTicketSnapshot', saveCall],
  ['router.replace', printRouteCall],
]) {
  assert(
    isTopLevelPostCreateCall(call, submitHandler.bodyNode, createPhase.statement),
    `${label} debe ser una sentencia post-éxito, fuera del try/catch de createExchange y sin callback anidado`,
  );
}

const evidencePersistenceTry = commonTryStatement([enqueueCall, persistCall]);
assert(
  evidencePersistenceTry && evidencePersistenceTry !== createPhase.statement,
  'enqueue y persistQueue deben compartir un try post-éxito propio',
);
assert(evidencePersistenceTry.catchClause, 'el fallo de preparación de evidencias debe tener catch');
const pendingEvidenceAlert = directAlertStatements(evidencePersistenceTry.catchClause.block)
  .find((statement) => /evidenc\w*[\s\S]{0,120}pendient/i.test(
    statement.expression.arguments.map((argument) => nodeText(argument)).join('\n'),
  ));
assert(
  pendingEvidenceAlert,
  'el catch de enqueue/persist debe mostrar Alert.alert con copy de evidencia pendiente',
);
const createExchangeCallsInEvidenceCatch = nodesInBody(
  evidencePersistenceTry.catchClause.block,
  ts.isCallExpression,
).filter((call) => (
  ts.isIdentifier(call.expression) && call.expression.text === 'createExchange'
));
assert.equal(
  createExchangeCallsInEvidenceCatch.length,
  0,
  'el catch de enqueue/persist no debe crear otro cambio',
);

const postSuccessOrder = [
  ['enqueueVisitPhotos', enqueueCall],
  ['await persistQueue()', persistCall],
  ['await saveExchangeTicketSnapshot(snapshot)', saveCall],
  ["router.replace('/print-exchange/[snapshotId]')", printRouteCall],
];
for (let index = 1; index < postSuccessOrder.length; index += 1) {
  assert(
    postSuccessOrder[index - 1][1].getStart(sourceFile)
      < postSuccessOrder[index][1].getStart(sourceFile),
    `${postSuccessOrder[index - 1][0]} debe ocurrir antes de ${postSuccessOrder[index][0]}`,
  );
}
assert(
  enqueueCall.getStart(sourceFile) > createPhase.statement.end
    && persistCall.getStart(sourceFile) > createPhase.statement.end,
  'enqueueVisitPhotos y persistQueue deben ocurrir después del TryStatement completo de createExchange',
);

const photoCase = syncSyntaxNodes.find((node) => (
  ts.isCaseClause(node)
  && node.expression.getText(syncSourceFile).replace(/^['"]|['"]$/g, '') === 'photo'
));
assert(photoCase, 'useSyncStore debe conservar el case photo');
const photoUploadCalls = syncSyntaxNodes.filter((node) => (
  ts.isCallExpression(node)
  && ts.isIdentifier(node.expression)
  && node.expression.text === 'uploadStopImage'
  && node.getStart(syncSourceFile) >= photoCase.getStart(syncSourceFile)
  && node.end <= photoCase.end
));
assert.equal(photoUploadCalls.length, 1, 'el case photo debe reenviar una sola llamada de upload');
assert(
  photoUploadCalls[0].arguments.some((argument) => (
    (() => {
      const fallbackOperand = ts.isBinaryExpression(argument)
        && argument.operatorToken.kind === ts.SyntaxKind.BarBarToken
        ? argument.left
        : argument;
      let unwrapped = fallbackOperand;
      while (ts.isParenthesizedExpression(unwrapped)) {
        unwrapped = unwrapped.expression;
      }
      if (ts.isAsExpression(unwrapped)) {
        unwrapped = unwrapped.expression;
      }
      return ts.isPropertyAccessExpression(unwrapped)
        && unwrapped.expression.getText(syncSourceFile) === 'payload'
        && unwrapped.name.text === 'image_type';
    })()
  )),
  'el retry de fotos debe reenviar payload.image_type como argumento de uploadStopImage',
);

console.log('exchange evidence wiring tests: assertions defined');
