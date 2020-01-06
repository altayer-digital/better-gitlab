// prevent exposing backend config on the frontend
if (typeof (window) !== 'undefined') {
  throw new Error('config cannot be used on front end');
}

const nconf = require('nconf');
const yaml = require('js-yaml');

const format = {
  parse: yaml.safeLoad,
  stringify: yaml.safeDump,
};

const nconfProvider = new nconf.Provider();

nconfProvider.file('user', {
  file: `${__dirname}/user.yml`,
  format,
});

nconfProvider.file('app-default', {
  file: `${__dirname}/default.yml`,
  format,
});


module.exports = nconfProvider.get();
