const path = require('path');
const jsBuilder = require('./JSBuilder');
const mdBuilder = require('./MDBuilder');
const Documentation = require('./Documentation');
const Browser = require('../../lib/Browser');

const PROJECT_DIR = path.join(__dirname, '..', '..');

let EXCLUDE_CLASSES = new Set([
  'Connection',
  'FrameManager',
  'Helper',
  'Navigator',
  'NetworkManager',
  'ProxyStream'
]);

let EXCLUDE_METHODS = new Set([
  'Body.constructor',
  'Dialog.constructor',
  'Frame.constructor',
  'Headers.constructor',
  'Headers.fromPayload',
  'InterceptedRequest.constructor',
  'Page.constructor',
  'Page.create',
  'Request.constructor',
  'Response.constructor',
]);

/**
 * @param {!Page} page
 * @param {string} docsFolderPath
 * @param {string} jsFolderPath
 * @return {!Promise<!Array<string>>}
 */
async function lint(page, docsFolderPath, jsFolderPath) {
  let mdResult = await mdBuilder(page, docsFolderPath);
  let jsResult = await jsBuilder(jsFolderPath);
  let jsDocumentation = filterJSDocumentation(jsResult);
  let mdDocumentation = mdResult.documentation;

  let jsErrors = [];
  let mdErrors = Documentation.diff(mdDocumentation, jsDocumentation);
  // Report all markdown parse errors.
  mdErrors.push(...mdResult.errors);

  jsErrors.push(...Documentation.validate(jsDocumentation));
  mdErrors.push(...Documentation.validate(mdDocumentation));
  mdErrors.push(...lintMarkdown(mdDocumentation));

  // Push all errors with proper prefixes
  let errors = jsErrors.map(error => '[JavaScript] ' + error);
  errors.push(...mdErrors.map(error => '[MarkDown] ' + error));
  return errors;
}

/**
 * @param {!Documentation} doc
 * @return {!Array<string>}
 */
function lintMarkdown(doc) {
  const errors = [];
  // Methods should be sorted alphabetically.
  for (let cls of doc.classesArray) {
    for (let i = 0; i < cls.methodsArray.length - 1; ++i) {
      // Constructor always goes first.
      if (cls.methodsArray[i].name === 'constructor') {
        if (i > 0)
          errors.push(`Constructor of ${cls.name} should go before other methods`);
        continue;
      }
      let method1 = cls.methodsArray[i];
      let method2 = cls.methodsArray[i + 1];
      if (method1.name > method2.name)
        errors.push(`${cls.name}.${method1.name} breaks alphabetic methods sorting inside class ${cls.name}`);
    }
  }
  return errors;
}

/**
 * @param {!Documentation} jsDocumentation
 * @return {!Documentation}
 */
function filterJSDocumentation(jsDocumentation) {
  // Filter classes and methods.
  let classes = [];
  for (let cls of jsDocumentation.classesArray) {
    if (EXCLUDE_CLASSES.has(cls.name))
      continue;
    let methods = cls.methodsArray.filter(method => {
      if (method.name.startsWith('_'))
        return false;
      return !EXCLUDE_METHODS.has(`${cls.name}.${method.name}`);
    });
    let properties = cls.propertiesArray.filter(property => !property.startsWith('_'));
    classes.push(new Documentation.Class(cls.name, methods, properties));
  }
  return new Documentation(classes);
}

module.exports = lint;

const RED_COLOR = '\x1b[31m';
const RESET_COLOR = '\x1b[0m';

// Handle CLI invocation.
if (!module.parent) {
  const startTime = Date.now();
  const browser = new Browser({args: ['--no-sandbox']});
  browser.newPage().then(async page => {
    const errors = await lint(page, path.join(PROJECT_DIR, 'docs'), path.join(PROJECT_DIR, 'lib'));
    await browser.close();
    if (errors.length) {
      console.log('Documentation Failures:');
      for (let i = 0; i < errors.length; ++i) {
        let error = errors[i];
        error = error.split('\n').join('\n    ');
        console.log(`${i + 1}) ${RED_COLOR}${error}${RESET_COLOR}`);
      }
    }
    console.log(`${errors.length} failures`);
    const runningTime = Date.now() - startTime;
    console.log(`Finished in ${runningTime / 1000} seconds`);
    process.exit(errors.length > 0 ? 1 : 0);
  });
}