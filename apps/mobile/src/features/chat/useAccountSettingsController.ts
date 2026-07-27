import { useEffect, useRef, useState } from "react";
import type {
  ActiveSession,
  AuthUser,
  ConnectedAccount,
  DataTransferJob
} from "@persona/shared";

export type SettingsPanel = "main" | "profile" | "security" | "sessions" | "about" | "data";
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
  }, [
    authUser?.id,
    authUser?.username,
    authUser?.preferredName,
    authUser?.gender,
    authUser?.birthday?.month,
    authUser?.birthday?.day
  ]);

  useEffect(() => {
    if (!profileNotice) return;
    const timer = setTimeout(() => setProfileNotice(undefined), 2400);
    return () => clearTimeout(timer);
  }, [profileNotice]);

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
