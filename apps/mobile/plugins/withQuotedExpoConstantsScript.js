const { withPodfile, withXcodeProject } = require("@expo/config-plugins");

const phaseName = "[CP-User] Generate app.config for prebuilt Constants.manifest";
const podfileAnchor = "  post_install do |installer|\n";
const podfilePatch = `    installer.pods_project.targets.each do |target|
      next unless target.name == 'EXConstants'

      target.shell_script_build_phases.each do |phase|
        next unless phase.name == '${phaseName}'

        # Expo's wrapper script reads $PROJECT_DIR without quotes. Invoke the
        # config generator directly so spaces in the workspace path do not
        # prevent app.config from being embedded in EXConstants.bundle.
        phase.shell_script = <<~'SCRIPT'
          set -e

          PROJECT_ROOT="$PODS_ROOT/../.."
          if [ "$BUNDLE_FORMAT" = "shallow" ]; then
            RESOURCE_DEST="$CONFIGURATION_BUILD_DIR/EXConstants.bundle"
          elif [ "$BUNDLE_FORMAT" = "deep" ]; then
            RESOURCE_DEST="$CONFIGURATION_BUILD_DIR/EXConstants.bundle/Contents/Resources"
          else
            echo "Unsupported bundle format: $BUNDLE_FORMAT"
            exit 1
          fi

          mkdir -p "$RESOURCE_DEST"
          "$PODS_TARGET_SRCROOT/../scripts/with-node.sh" "$PODS_TARGET_SRCROOT/../scripts/getAppConfig.js" "$PROJECT_ROOT" "$RESOURCE_DEST"
        SCRIPT
      end
    end

`;

function withQuotedExpoConstantsScript(config) {
  return withPodfile(config, (podfileConfig) => {
    const { contents } = podfileConfig.modResults;

    if (contents.includes("target.name == 'EXConstants'")) {
      return podfileConfig;
    }

    if (!contents.includes(podfileAnchor)) {
      throw new Error("Unable to add the Expo Constants iOS path quoting patch to the Podfile.");
    }

    podfileConfig.modResults.contents = contents.replace(podfileAnchor, `${podfileAnchor}${podfilePatch}`);
    return podfileConfig;
  });
}

function withQuotedReactNativeBundleScript(config) {
  return withXcodeProject(config, (xcodeProjectConfig) => {
    const phases = xcodeProjectConfig.modResults.hash.project.objects.PBXShellScriptBuildPhase;
    const invocation =
      "`\\\"$NODE_BINARY\\\" --print \\\"require('path').dirname(require.resolve('react-native/package.json')) + '/scripts/react-native-xcode.sh'\\\"`";
    const replacement =
      "REACT_NATIVE_XCODE_SCRIPT=\\\"$(\\\"$NODE_BINARY\\\" --print \\\"require('path').dirname(require.resolve('react-native/package.json')) + '/scripts/react-native-xcode.sh'\\\")\\\"\\n\\\"$REACT_NATIVE_XCODE_SCRIPT\\\"";

    for (const phase of Object.values(phases)) {
      if (phase?.name !== '\"Bundle React Native code and images\"') {
        continue;
      }

      if (!phase.shellScript.includes("REACT_NATIVE_XCODE_SCRIPT")) {
        phase.shellScript = phase.shellScript.replace(invocation, replacement);
      }
    }

    return xcodeProjectConfig;
  });
}

module.exports = function withQuotedIosBuildScripts(config) {
  return withQuotedReactNativeBundleScript(withQuotedExpoConstantsScript(config));
};
