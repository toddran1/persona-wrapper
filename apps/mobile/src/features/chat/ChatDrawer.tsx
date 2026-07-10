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
  onShowSettings: () => void;
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
  onShowSettings
}: ChatDrawerProps) {
  const accountInitial = (authUser?.displayName?.[0] ?? authUser?.username?.[0] ?? authUser?.email?.[0] ?? "P").toUpperCase();

  return (
    <View style={[styles.drawer, { backgroundColor: theme.background, borderRightColor: theme.border }]}>
      <View style={[styles.rail, { backgroundColor: theme.rail }]} />
      <View style={styles.header}>
        <Text style={[styles.brand, { color: theme.text }]}>Persona</Text>
        <View style={[styles.accountPill, { borderColor: theme.border, backgroundColor: "rgba(255,255,255,0.075)" }]}>
          <Pressable accessibilityRole="button" accessibilityLabel="Search chats" style={styles.pillIconButton}>
            <Ionicons name="search" size={21} color={theme.text} />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={authUser ? "Open settings" : "Sign in"}
            onPress={authUser ? onShowSettings : onShowLogin}
            style={[styles.accountAvatar, { backgroundColor: theme.accent }]}
          >
            <Text style={[styles.accountInitial, { color: theme.text }]}>{accountInitial}</Text>
          </Pressable>
        </View>
      </View>

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
    </View>
  );
}

type DrawerStyles = {
  accountAvatar: ViewStyle;
  accountInitial: TextStyle;
  accountPill: ViewStyle;
  brand: TextStyle;
  conversationCopy: ViewStyle;
  conversationAction: ViewStyle;
  conversationList: ViewStyle;
  conversationRow: ViewStyle;
  conversationTitle: TextStyle;
  drawer: ViewStyle;
  empty: TextStyle;
  header: ViewStyle;
  newChat: ViewStyle;
  newChatText: TextStyle;
  pillIconButton: ViewStyle;
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
    height: 42,
    justifyContent: "center",
    width: 42
  },
  accountInitial: {
    fontSize: 16,
    fontWeight: "900",
    textTransform: "uppercase"
  },
  accountPill: {
    alignItems: "center",
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: "row",
    gap: 8,
    minHeight: 54,
    paddingHorizontal: 9
  },
  brand: {
    fontSize: 36,
    fontWeight: "900",
    letterSpacing: 0
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
    paddingTop: 20
  },
  empty: {
    fontSize: 14,
    lineHeight: 20,
    padding: 12
  },
  header: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 22,
    paddingVertical: 18
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
  pillIconButton: {
    alignItems: "center",
    height: 42,
    justifyContent: "center",
    width: 42
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
