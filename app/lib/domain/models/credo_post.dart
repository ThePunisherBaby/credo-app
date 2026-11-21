import 'credo_user.dart';
import 'ecclesiastical_unit.dart';

class CredoPost {
  const CredoPost({
    required this.id,
    required this.postType,
    this.title = '',
    required this.content,
    this.scriptureRef = '',
    this.eventDate,
    this.eventLocation = '',
    this.language = 'es',
    this.isPinned = false,
    required this.createdAt,
    required this.author,
    this.scopeUnit,
    required this.reactions,
    required this.myReactions,
    required this.commentsCount,
  });

  final int id;
  final String postType;
  final String title;
  final String content;
  final String scriptureRef;
  final DateTime? eventDate;
  final String eventLocation;
  final String language;
  final bool isPinned;
  final DateTime createdAt;
  final CredoUser author;
  final EcclesiasticalUnit? scopeUnit;
  final Map<String, int> reactions;
  final Set<String> myReactions;
  final int commentsCount;

  CredoPost copyWith({
    Map<String, int>? reactions,
    Set<String>? myReactions,
    int? commentsCount,
  }) {
    return CredoPost(
      id: id,
      postType: postType,
      title: title,
      content: content,
      scriptureRef: scriptureRef,
      eventDate: eventDate,
      eventLocation: eventLocation,
      language: language,
      isPinned: isPinned,
      createdAt: createdAt,
      author: author,
      scopeUnit: scopeUnit,
      reactions: reactions ?? this.reactions,
      myReactions: myReactions ?? this.myReactions,
      commentsCount: commentsCount ?? this.commentsCount,
    );
  }

  factory CredoPost.fromJson(Map<String, dynamic> json) {
    final rawScope = json['scope_unit'] as Map<String, dynamic>?;
    final rawReactions = json['reactions'] as Map<String, dynamic>? ?? const {};
    final rawMy = json['my_reactions'] as List<dynamic>? ?? const [];
    return CredoPost(
      id: (json['id'] as num).toInt(),
      postType: (json['post_type'] as String?) ?? 'reflection',
      title: (json['title'] as String?) ?? '',
      content: (json['content'] as String?) ?? '',
      scriptureRef: (json['scripture_ref'] as String?) ?? '',
      eventDate: json['event_date'] != null
          ? DateTime.tryParse(json['event_date'].toString())
          : null,
      eventLocation: (json['event_location'] as String?) ?? '',
      language: (json['language'] as String?) ?? 'es',
      isPinned: (json['is_pinned'] as bool?) ?? false,
      createdAt:
          DateTime.tryParse(json['created_at'].toString()) ?? DateTime.now(),
      author: CredoUser.fromJson(json['author'] as Map<String, dynamic>),
      scopeUnit:
          rawScope != null ? EcclesiasticalUnit.fromJson(rawScope) : null,
      reactions: {
        'amen': (rawReactions['amen'] as num?)?.toInt() ?? 0,
        'pray': (rawReactions['pray'] as num?)?.toInt() ?? 0,
        'gratitude': (rawReactions['gratitude'] as num?)?.toInt() ?? 0,
      },
      myReactions: rawMy.map((e) => e.toString()).toSet(),
      commentsCount: (json['comments_count'] as num?)?.toInt() ?? 0,
    );
  }
}

class CredoComment {
  const CredoComment({
    required this.id,
    required this.postId,
    required this.content,
    required this.createdAt,
    required this.author,
  });

  final int id;
  final int postId;
  final String content;
  final DateTime createdAt;
  final CredoUser author;

  factory CredoComment.fromJson(Map<String, dynamic> json) {
    return CredoComment(
      id: (json['id'] as num).toInt(),
      postId: (json['post_id'] as num).toInt(),
      content: (json['content'] as String?) ?? '',
      createdAt:
          DateTime.tryParse(json['created_at'].toString()) ?? DateTime.now(),
      author: CredoUser.fromJson(json['author'] as Map<String, dynamic>),
    );
  }
}
