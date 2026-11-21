import 'credo_user.dart';

class CredoConversation {
  const CredoConversation({
    required this.id,
    required this.kind,
    required this.title,
    this.description = '',
    this.unitId,
    this.unitName,
    this.unitType,
    this.unitAccentColor = '#6B2D5C',
    this.membersCount = 0,
    this.peer,
    this.lastMessageContent = '',
    this.lastMessageAt,
    this.lastSenderName = '',
    this.isMember = true,
  });

  final int id;
  final String kind;
  final String title;
  final String description;
  final int? unitId;
  final String? unitName;
  final String? unitType;
  final String unitAccentColor;
  final int membersCount;
  final CredoUser? peer;
  final String lastMessageContent;
  final DateTime? lastMessageAt;
  final String lastSenderName;
  final bool isMember;

  bool get isGroup => kind == 'pastoral_group';

  factory CredoConversation.fromJson(Map<String, dynamic> json) {
    final rawPeer = json['peer'] as Map<String, dynamic>?;
    return CredoConversation(
      id: (json['id'] as num).toInt(),
      kind: (json['kind'] as String?) ?? 'pastoral_group',
      title: (json['title'] as String?) ?? '',
      description: (json['description'] as String?) ?? '',
      unitId: (json['unit_id'] as num?)?.toInt(),
      unitName: json['unit_name'] as String?,
      unitType: json['unit_type'] as String?,
      unitAccentColor: (json['unit_accent_color'] as String?) ?? '#6B2D5C',
      membersCount: (json['members_count'] as num?)?.toInt() ?? 0,
      peer: rawPeer != null ? CredoUser.fromJson(rawPeer) : null,
      lastMessageContent: (json['last_message_content'] as String?) ?? '',
      lastMessageAt: json['last_message_at'] != null
          ? DateTime.tryParse(json['last_message_at'].toString())
          : null,
      lastSenderName: (json['last_sender_name'] as String?) ?? '',
      isMember: (json['is_member'] as bool?) ?? true,
    );
  }
}

class CredoMessage {
  const CredoMessage({
    required this.id,
    required this.conversationId,
    required this.content,
    required this.createdAt,
    required this.sender,
  });

  final int id;
  final int conversationId;
  final String content;
  final DateTime createdAt;
  final CredoUser sender;

  factory CredoMessage.fromJson(Map<String, dynamic> json) {
    return CredoMessage(
      id: (json['id'] as num).toInt(),
      conversationId: (json['conversation_id'] as num).toInt(),
      content: (json['content'] as String?) ?? '',
      createdAt:
          DateTime.tryParse(json['created_at'].toString()) ?? DateTime.now(),
      sender: CredoUser.fromJson(json['sender'] as Map<String, dynamic>),
    );
  }
}
