const { withPodfile, withXcodeProject } = require("@expo/config-plugins");

const phaseName = "[CP-User] Generate app.config for prebuilt Constants.manifest";
const podfileAnchor = "  post_install do |installer|\n";
const podfilePatch = `    installer.pods_project.targets.each do |target|
      next unless target.name == 'EXConstants'

      target.shell_script_build_phases.each do |phase|
        next unless phase.name == '${phaseName}'

        # Quote the script path and explicitly point Expo Constants at the app root.
        # Both are needed when the workspace path contains spaces.
        phase.shell_script = 'bash -l -c \"PROJECT_ROOT=\\\"$PODS_ROOT/../..\\\" \\\"$PODS_TARGET_SRCROOT/../scripts/get-app-config-ios.sh\\\"\"'
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
