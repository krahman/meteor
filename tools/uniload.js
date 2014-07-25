var _ = require('underscore');
var bundler = require('./bundler.js');
var buildmessage = require('./buildmessage.js');
var release = require('./release.js');
var packageLoader = require("./package-loader.js");
var packageCache = require("./package-cache.js");
var files = require('./files.js');

// Load unipackages into the currently running node.js process. Use
// this to use unipackages (such as the DDP client) from command-line
// tools (such as 'meteor'). The requested packages will be loaded
// together will all of their dependencies, and each time you call
// this function you load another, distinct copy of all of the
// packages (except see note about caching below). The return value is
// an object that maps package name to package exports (that is, it is
// the Unipackage object from inside the sandbox created for the newly
// loaded packages).
//
// Caching: There is a simple cache. If you call this function with
// exactly the same release and packages, we will attempt to return
// the memoized return value from the previous load (rather than
// creating a whole new copy of the packages in memory). The caching
// logic is not particularly sophisticated. For example, the cache
// will not be flushed if packages change on disk, even if it should
// be, but using a different release name will flush the cache
// completely.
//
// When run from a checkout, uniload only loads local (from the checkout)
// packages: never packages from troposphere. When run from a release build,
// uniload only loads pre-built unipackages that are distributed alongside the
// tool: never local packages or packages from troposphere (so in this mode, it
// never compiles the source of a real package).
//
// Options:
// - packages: The packages to load, as an array of strings. Each
//   string may be either "packagename" or "packagename.slice".
//
// Example usage:
//   var DDP = require('./uniload.js').load({
//     packages: ['livedata'],
//     release: release.current.name
//   }).livedata.DDP;
//   var reverse = DDP.connect('reverse.meteor.com');
//   console.log(reverse.call('reverse', 'hello world'));

var cacheRelease = undefined;
var cache = {}; // map from package names (joined with ',') to return value

var load = function (options) {
  options = options || {};

  // Check the cache first
  var cacheKey = (options.packages || []).join(',');

  if (_.has(cache, cacheKey)) {
    return cache[cacheKey];
  }

  // Set up a minimal server-like environment (omitting the parts that
  // are specific to the HTTP server). Kind of a hack. I suspect this
  // will get refactored before too long. Note that
  // __meteor_bootstrap__.require is no longer provided.
  var env = {
    __meteor_bootstrap__: { startupHooks: [] },
    __meteor_runtime_config__: { meteorRelease: "UNILOAD" }
  };

  var ret;
  var messages = buildmessage.capture({
    title: "loading unipackage"
  }, function () {

    // Load the code. The uniloader does not call the constraint solver, unless
    // it is running from checkout, in which case it will use the constraint
    // solver to build its packages in the catalog.
    var loader = new packageLoader.PackageLoader({
      versions: null,
      uniloadDir: files.getUniloadDir(),
      constraintSolverOpts: { ignoreProjectDeps: true }
    });

    // Build the bundler image.
    //
    // Passing in dependency versions doesn't really make any sense here. We
    // don't know the previous dependencies of this package, and, anyway, if we
    // are running from checkout, they are all +local, and if we are running
    // from release it is a bunch of unipackages. So, we don't pass in
    // dependency versions.
    var image = bundler.buildJsImage({
      name: "load",
      packageLoader: loader,
      use: options.packages || []
    }).image;
    ret = image.load(env);

    // Run any user startup hooks.
    while (env.__meteor_bootstrap__.startupHooks.length) {
      var hook = env.__meteor_bootstrap__.startupHooks.shift();
      hook();
    }
    // Setting this to null tells Meteor.startup to call hooks immediately.
    env.__meteor_bootstrap__.startupHooks = null;
  });

  if (messages.hasMessages()) {
    // XXX This error handling is not the best, but this should never
    // happen in a built release. In the future, the command line
    // tool will be a normal Meteor app and will be built ahead of
    // time like any other app and this case will disappear.
    process.stdout.write("Errors prevented unipackage load:\n");
    process.stdout.write(messages.formatMessages());
    throw new Error("unipackage load failed?");
  }

  // Save to cache
  cache[cacheKey] = ret;

  return ret;
};

var uniload = exports;
_.extend(exports, {
  load: load
});
