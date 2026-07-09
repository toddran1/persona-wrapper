import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View, type TextStyle, type ViewStyle } from "react-native";
import type { AuthUser, ConversationSummary, PersonaSummary } from "@persona/shared";
import { Ionicons } from "@expo/vector-icons";
import type { MobileTheme } from "../../theme/personaTheme";
import { formatConversationTime } from "./mobileChatUtils";

type ChatDrawerProps = {
  authUser?: AuthUser | undefined;
  conversations: ConversationSummary[];
  activeConversationId?: string | undefined;
  personas: PersonaSummary[];
  activePersona?: PersonaSummary | undefined;
  theme: MobileTheme;
  loading: boolean;
  refreshing: boolean;
  onClose: () => void;
  onNewChat: () => void;
  onSelectConversation: (conversationId: string) => void;
  onShowConversationActions: (conversation: ConversationSummary) => void;
  onRefreshConversations: () => void;
  onSelectPersona: (personaId: string) => void;
  onShowLogin: () => void;
  onLogout: () => void;
};

export function ChatDrawer({
  authUser,
  conversations,
  activeConversationId,
  personas,
  activePersona,
  theme,
  loading,
  refreshing,
  onClose,
  onNewChat,
  onSelectConversation,
  onShowConversationActions,
  onRefreshConversations,
  onSelectPersona,
  onShowLogin,
  onLogout
}: ChatDrawerProps) {
  return (
    <View style={[styles.drawer, { backgroundColor: theme.background, borderRightColor: theme.border }]}>
      <View style={[styles.rail, { backgroundColor: theme.rail }]} />
      <View style={styles.header}>
        <View>
          <Text style={[styles.brand, { color: theme.text }]}>Persona Wrapper</Text>
          <Text style={[styles.subtle, { color: theme.muted }]}>Chats and personas</Text>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel="Close drawer" onPress={onClose} style={styles.close}>
          <Ionicons name="close" size={22} color={theme.text} />
        </Pressable>
      </View>

      <Pressable
        accessibilityRole="button"
        onPress={authUser ? onLogout : onShowLogin}
        style={[styles.accountCard, { borderColor: theme.border, backgroundColor: "rgba(255,255,255,0.055)" }]}
      >
        <View style={[styles.accountAvatar, { backgroundColor: theme.accent }]}>
          <Text style={[styles.accountInitial, { color: theme.text }]}>{authUser?.displayName?.[0] ?? authUser?.username?.[0] ?? "P"}</Text>
        </View>
        <View style={styles.accountCopy}>
          <Text style={[styles.accountTitle, { color: theme.text }]} numberOfLines={1}>
            {authUser?.displayName ?? authUser?.username ?? "Sign in"}
          </Text>
          <Text style={[styles.subtle, { color: theme.muted }]} numberOfLines={1}>
            {authUser ? "Tap to sign out" : "Sync chats across devices"}
          </Text>
        </View>
      </Pressable>

      <Pressable accessibilityRole="button" onPress={onNewChat} style={[styles.newChat, { backgroundColor: theme.text }]}>
        <Ionicons name="create-outline" size={18} color={theme.background} />
        <Text style={[styles.newChatText, { color: theme.background }]}>New chat</Text>
      </Pressable>

      <View style={styles.section}>
        <Text style={[styles.sectionLabel, { color: theme.accent2 }]}>Persona</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.personaRow}>
          {personas.map((persona) => {
            const selected = persona.id === activePersona?.id;
            return (
              <Pressable
                key={persona.id}
                accessibilityRole="button"
                onPress={() => onSelectPersona(persona.id)}
                style={[
                  styles.personaChip,
                  {
                    borderColor: selected ? theme.accent2 : theme.border,
                    backgroundColor: selected ? "rgba(214,181,94,0.16)" : "rgba(255,255,255,0.04)"
                  }
                ]}
              >
                <Text style={[styles.personaChipText, { color: theme.text }]}>{persona.name}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      <View style={styles.sectionHeader}>
        <Text style={[styles.sectionLabel, { color: theme.accent2 }]}>Chats</Text>
        <Text style={[styles.subtle, { color: theme.muted }]}>{loading ? "Loading" : `${conversations.length}`}</Text>
      </View>
      <ScrollView
        contentContainerStyle={styles.conversationList}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefreshConversations}
            tintColor={theme.accent2}
          />
        }
      >
        {conversations.length === 0 ? (
          <Text style={[styles.empty, { color: theme.muted }]}>No chats yet. Start with the persona that fits the mood.</Text>
        ) : conversations.map((conversation) => {
          const selected = conversation.id === activeConversationId;
          return (
            <Pressable
              key={conversation.id}
              accessibilityRole="button"
              onPress={() => onSelectConversation(conversation.id)}
              style={[
                styles.conversationRow,
                {
                  borderColor: selected ? theme.accent2 : "transparent",
                  backgroundColor: selected ? "rgba(214,181,94,0.13)" : "transparent"
                }
              ]}
            >
              <Ionicons name={conversation.pinned ? "bookmark" : "chatbubble-outline"} size={16} color={selected ? theme.accent2 : theme.muted} />
              <View style={styles.conversationCopy}>
                <Text style={[styles.conversationTitle, { color: theme.text }]} numberOfLines={1}>{conversation.title}</Text>
                <Text style={[styles.subtle, { color: theme.muted }]}>{formatConversationTime(conversation.updatedAt)}</Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Actions for ${conversation.title}`}
                onPress={(event) => {
                  event.stopPropagation();
                  onShowConversationActions(conversation);
                }}
                style={styles.conversationAction}
              >
                <Ionicons name="ellipsis-horizontal" size={18} color={theme.muted} />
              </Pressable>
            </Pressable>
          );
        })}
      </ScrollView>
      <View style={[styles.footer, { borderTopColor: theme.border }]}>
        <Ionicons name="settings-outline" size={18} color={theme.muted} />
        <Text style={[styles.footerText, { color: theme.muted }]}>Settings</Text>
      </View>
    </View>
  );
}

type DrawerStyles = {
  accountAvatar: ViewStyle;
  accountCard: ViewStyle;
  accountCopy: ViewStyle;
  accountInitial: TextStyle;
  accountTitle: TextStyle;
  brand: TextStyle;
  close: ViewStyle;
  conversationCopy: ViewStyle;
  conversationAction: ViewStyle;
  conversationList: ViewStyle;
  conversationRow: ViewStyle;
  conversationTitle: TextStyle;
  drawer: ViewStyle;
  empty: TextStyle;
  footer: ViewStyle;
  footerText: TextStyle;
  header: ViewStyle;
  newChat: ViewStyle;
  newChatText: TextStyle;
  personaChip: ViewStyle;
  personaChipText: TextStyle;
  personaRow: ViewStyle;
  rail: ViewStyle;
  section: ViewStyle;
  sectionHeader: ViewStyle;
  sectionLabel: TextStyle;
  subtle: TextStyle;
};

const styles = StyleSheet.create<DrawerStyles>({
  accountAvatar: {
    alignItems: "center",
    borderRadius: 999,
    height: 38,
    justifyContent: "center",
    width: 38
  },
  accountCard: {
    alignItems: "center",
    borderRadius: 18,
    borderWidth: 1,
    flexDirection: "row",
    gap: 11,
    marginHorizontal: 14,
    padding: 12
  },
  accountCopy: {
    flex: 1,
    minWidth: 0
  },
  accountInitial: {
    fontSize: 15,
    fontWeight: "900",
    textTransform: "uppercase"
  },
  accountTitle: {
    fontSize: 15,
    fontWeight: "800"
  },
  brand: {
    fontSize: 17,
    fontWeight: "900",
    letterSpacing: 0.2
  },
  close: {
    alignItems: "center",
    height: 40,
    justifyContent: "center",
    width: 40
  },
  conversationCopy: {
    flex: 1,
    minWidth: 0
  },
  conversationAction: {
    alignItems: "center",
    borderRadius: 999,
    height: 34,
    justifyContent: "center",
    width: 34
  },
  conversationList: {
    gap: 3,
    paddingBottom: 18,
    paddingHorizontal: 10
  },
  conversationRow: {
    alignItems: "center",
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: "row",
    gap: 10,
    minHeight: 48,
    paddingHorizontal: 10
  },
  conversationTitle: {
    fontSize: 14,
    fontWeight: "600"
  },
  drawer: {
    borderRightWidth: 1,
    flex: 1,
    paddingTop: 8
  },
  empty: {
    fontSize: 14,
    lineHeight: 20,
    padding: 12
  },
  footer: {
    alignItems: "center",
    borderTopWidth: 1,
    flexDirection: "row",
    gap: 10,
    minHeight: 54,
    paddingHorizontal: 18
  },
  footerText: {
    fontSize: 14,
    fontWeight: "700"
  },
  header: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    padding: 14
  },
  newChat: {
    alignItems: "center",
    borderRadius: 18,
    flexDirection: "row",
    gap: 8,
    justifyContent: "center",
    margin: 14,
    minHeight: 46
  },
  newChatText: {
    fontSize: 15,
    fontWeight: "900"
  },
  personaChip: {
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 9
  },
  personaChipText: {
    fontSize: 13,
    fontWeight: "800"
  },
  personaRow: {
    gap: 8,
    paddingRight: 14
  },
  rail: {
    bottom: 0,
    position: "absolute",
    right: 0,
    top: 0,
    width: 3
  },
  section: {
    gap: 10,
    paddingLeft: 14,
    paddingVertical: 8
  },
  sectionHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 14,
    paddingVertical: 8
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 1.1,
    textTransform: "uppercase"
  },
  subtle: {
    fontSize: 12,
    lineHeight: 17
  }
});
