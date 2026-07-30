import { useEffect, useRef, useState } from "react";
import type {
  ActiveSession,
  AuthUser,
  ConnectedAccount,
  DataTransferJob,
  PlanUsageSummary
} from "@persona/shared";

export type SettingsPanel = "main" | "profile" | "plan" | "audio" | "security" | "sessions" | "memory" | "about" | "data";
export type ProfileSelectionKind = "gender" | "month" | "day";

export function useAccountSettingsController(authUser: AuthUser | undefined) {
  const [settingsVisible, setSettingsVisible] = useState(false);
  const [settingsPanel, setSettingsPanel] = useState<SettingsPanel>("main");
  const [landscapeLayoutEnabled, setLandscapeLayoutEnabledState] = useState(false);
  const [landscapePreferenceBusy, setLandscapePreferenceBusy] = useState(false);
  const [activeSessions, setActiveSessions] = useState<ActiveSession[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [sessionsError, setSessionsError] = useState<string | undefined>();
  const [sessionActionId, setSessionActionId] = useState<string | undefined>();
  const [connectedAccounts, setConnectedAccounts] = useState<ConnectedAccount[]>([]);
  const [securityLoading, setSecurityLoading] = useState(false);
  const [securityError, setSecurityError] = useState<string | undefined>();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newPasswordConfirmation, setNewPasswordConfirmation] = useState("");
  const [profileUsername, setProfileUsername] = useState("");
  const [preferredName, setPreferredName] = useState("");
  const [profileGender, setProfileGender] = useState<AuthUser["gender"] | "">("");
  const [birthMonth, setBirthMonth] = useState("");
  const [birthDay, setBirthDay] = useState("");
  const [profileBusy, setProfileBusy] = useState(false);
  const [profileError, setProfileError] = useState<string | undefined>();
  const [profileNotice, setProfileNotice] = useState<string | undefined>();
  const [profileSelection, setProfileSelection] = useState<ProfileSelectionKind | undefined>();
  const [planUsage, setPlanUsage] = useState<PlanUsageSummary | undefined>();
  const [planUsageLoading, setPlanUsageLoading] = useState(false);
  const [planUsageError, setPlanUsageError] = useState<string | undefined>();
  const [memoryEnabled, setMemoryEnabled] = useState(true);
  const [memoryBusy, setMemoryBusy] = useState(false);
  const [memoryError, setMemoryError] = useState<string | undefined>();
  const [memoryNotice, setMemoryNotice] = useState<string | undefined>();
  const [conciseAudioResponses, setConciseAudioResponses] = useState(true);
  const [audioSettingsBusy, setAudioSettingsBusy] = useState(false);
  const [audioSettingsError, setAudioSettingsError] = useState<string | undefined>();
  const [audioSettingsNotice, setAudioSettingsNotice] = useState<string | undefined>();
  const [dataTransferJob, setDataTransferJob] = useState<DataTransferJob | undefined>();
  const [deleteAccountVisible, setDeleteAccountVisible] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [deletePassword, setDeletePassword] = useState("");
  const [deleteAccountBusy, setDeleteAccountBusy] = useState(false);
  const [deleteAccountError, setDeleteAccountError] = useState<string | undefined>();
  const accountIdRef = useRef(authUser?.id);

  useEffect(() => {
    const accountChanged = accountIdRef.current !== authUser?.id;
    accountIdRef.current = authUser?.id;

    if (accountChanged) {
      // This controller remains mounted while the app moves between auth and
      // chat screens. Never let one account's security or transfer state
      // survive a logout or an account switch.
      setSettingsVisible(false);
      setSettingsPanel("main");
      setActiveSessions([]);
      setSessionsLoading(false);
      setSessionsError(undefined);
      setSessionActionId(undefined);
      setConnectedAccounts([]);
      setSecurityLoading(false);
      setSecurityError(undefined);
      setCurrentPassword("");
      setNewPassword("");
      setNewPasswordConfirmation("");
      setProfileBusy(false);
      setProfileError(undefined);
      setProfileNotice(undefined);
      setProfileSelection(undefined);
      setPlanUsage(undefined);
      setPlanUsageLoading(false);
      setPlanUsageError(undefined);
      setMemoryEnabled(true);
      setMemoryBusy(false);
      setMemoryError(undefined);
      setMemoryNotice(undefined);
      setConciseAudioResponses(true);
      setAudioSettingsBusy(false);
      setAudioSettingsError(undefined);
      setAudioSettingsNotice(undefined);
      setDataTransferJob(undefined);
      setDeleteAccountVisible(false);
      setDeleteConfirmation("");
      setDeletePassword("");
      setDeleteAccountBusy(false);
      setDeleteAccountError(undefined);
    } else if (!authUser) {
      setProfileSelection(undefined);
    }

    setProfileUsername(authUser?.username ?? "");
    setPreferredName(authUser?.preferredName ?? "");
    setProfileGender(authUser?.gender ?? "");
    setBirthMonth(authUser?.birthday?.month.toString() ?? "");
    setBirthDay(authUser?.birthday?.day.toString() ?? "");
    setConciseAudioResponses(authUser?.conciseAudioResponses ?? true);
  }, [
    authUser?.id,
    authUser?.username,
    authUser?.preferredName,
    authUser?.gender,
    authUser?.birthday?.month,
    authUser?.birthday?.day,
    authUser?.conciseAudioResponses
  ]);

  useEffect(() => {
    if (!profileNotice) return;
    const timer = setTimeout(() => setProfileNotice(undefined), 2400);
    return () => clearTimeout(timer);
  }, [profileNotice]);

  useEffect(() => {
    if (!audioSettingsNotice) return;
    const timer = setTimeout(() => setAudioSettingsNotice(undefined), 2400);
    return () => clearTimeout(timer);
  }, [audioSettingsNotice]);

  return {
    settingsVisible,
    setSettingsVisible,
    settingsPanel,
    setSettingsPanel,
    landscapeLayoutEnabled,
    setLandscapeLayoutEnabledState,
    landscapePreferenceBusy,
    setLandscapePreferenceBusy,
    activeSessions,
    setActiveSessions,
    sessionsLoading,
    setSessionsLoading,
    sessionsError,
    setSessionsError,
    sessionActionId,
    setSessionActionId,
    connectedAccounts,
    setConnectedAccounts,
    securityLoading,
    setSecurityLoading,
    securityError,
    setSecurityError,
    currentPassword,
    setCurrentPassword,
    newPassword,
    setNewPassword,
    newPasswordConfirmation,
    setNewPasswordConfirmation,
    profileUsername,
    setProfileUsername,
    preferredName,
    setPreferredName,
    profileGender,
    setProfileGender,
    birthMonth,
    setBirthMonth,
    birthDay,
    setBirthDay,
    profileBusy,
    setProfileBusy,
    profileError,
    setProfileError,
    profileNotice,
    setProfileNotice,
    profileSelection,
    setProfileSelection,
    planUsage,
    setPlanUsage,
    planUsageLoading,
    setPlanUsageLoading,
    planUsageError,
    setPlanUsageError,
    memoryEnabled,
    setMemoryEnabled,
    memoryBusy,
    setMemoryBusy,
    memoryError,
    setMemoryError,
    memoryNotice,
    setMemoryNotice,
    conciseAudioResponses,
    setConciseAudioResponses,
    audioSettingsBusy,
    setAudioSettingsBusy,
    audioSettingsError,
    setAudioSettingsError,
    audioSettingsNotice,
    setAudioSettingsNotice,
    dataTransferJob,
    setDataTransferJob,
    deleteAccountVisible,
    setDeleteAccountVisible,
    deleteConfirmation,
    setDeleteConfirmation,
    deletePassword,
    setDeletePassword,
    deleteAccountBusy,
    setDeleteAccountBusy,
    deleteAccountError,
    setDeleteAccountError
  };
}
