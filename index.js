const { Print } = require('@ianwalter/print')

const hasBsl = cap => cap['browserstack.local']

function shouldStartBsl (capabilities) {
  if (Array.isArray(capabilities)) {
    return capabilities.some(hasBsl)
  } else {
    return hasBsl(capabilities)
  }
}
function toBrowserTest (test) {
  return capability => {
    const browserstack = capability['bstack:options']
    //
    if (browserstack) {
      browserstack.name = test.name
    }

    //
    let name = `${test.name} in ${capability.browserName}`
    if (capability.browserVersion) {
      name += ` ${capability.browserVersion}`
    }
    if (browserstack.os) {
      name += ` on ${browserstack.os}`
    }
    if (browserstack.osVersion) {
      name += ` ${browserstack.osVersion}`
    }
    return { ...test, name, capability }
  }
}
function toBrowserTests (capabilities) {
  return (acc, test) => acc.concat(capabilities.map(toBrowserTest(test)))
}

let seleniumStandalone
let browserstackLocal

module.exports = async function bffWebdriver (hook, context) {
  const print = new Print({ level: context.logLevel })
  print.debug(`bff-webdriver ${hook} hook`)

  if (hook === 'registration') {
    const capabilities = Array.isArray(context.webdriver.capabilities)
      ? context.webdriver.capabilities
      : [context.webdriver.capabilities]
    const registrationContext = context.registrationContext
    registrationContext.tests = registrationContext.tests.reduce(
      toBrowserTests(capabilities),
      []
    )
  } else if (hook === 'before') {
    if (context.webdriver.standalone) {
      print.debug('Starting Selenium Standalone')
      return new Promise((resolve, reject) => {
        const standalone = require('selenium-standalone')
        const options = { spawnOptions: { stdio: 'inherit' } }
        standalone.start(options, (err, child) => {
          if (err) {
            if (child) {
              child.kill()
            }
            reject(err)
          } else {
            seleniumStandalone = child
            resolve()
          }
        })
      })
    } else if (shouldStartBsl(context.webdriver.capabilities)) {
      print.debug('Starting BrowserStack Local')
      const { Local } = require('browserstack-local')
      browserstackLocal = new Local()
      return new Promise((resolve, reject) => {
        const force = true
        const verbose = context.logLevel === 'debug'
        browserstackLocal.start({ force, forceLocal: force, verbose }, err => {
          if (err) {
            reject(err)
          } else {
            resolve()
          }
        })
      })
    }
  } else if (hook === 'beforeEach') {
    print.debug('Creating WebdriverIO browser instance')

    // Set up the browser instance and add it to the test context.
    const { remote } = require('webdriverio')
    context.testContext.browser = await remote({
      ...context.webdriver,
      logLevel: context.webdriver.logLevel || context.logLevel,
      capabilities: context.testContext.capability
    })
  } else if (hook === 'afterEach') {
    print.debug('Terminating WebdriverIO browser instance')

    // Tell Selenium to delete the browser session once the test is over.
    await context.testContext.browser.deleteSession()
  } else if (hook === 'after') {
    if (seleniumStandalone) {
      print.debug('Stopping Selenium Standalone')
      seleniumStandalone.kill()
    } else if (browserstackLocal) {
      print.debug('Stopping BrowserStack Local')
      browserstackLocal.stop()
    }
  }
}
