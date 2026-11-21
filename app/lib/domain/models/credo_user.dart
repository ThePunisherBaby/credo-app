import 'ecclesiastical_unit.dart';

class UserAssignment {
  const UserAssignment({
    required this.id,
    required this.unitId,
    required this.unitName,
    required this.unitType,
    required this.roleTitle,
    this.startYear,
    this.endYear,
    this.isCurrent = true,
    this.isPrimary = false,
    this.city = '',
    this.countryCode = '',
    this.countryName = '',
    this.accentColor = '#6B2D5C',
    this.notes = '',
  });

  final int id;
  final int unitId;
  final String unitName;
  final String unitType;
  final String roleTitle;
  final int? startYear;
  final int? endYear;
  final bool isCurrent;
  final bool isPrimary;
  final String city;
  final String countryCode;
  final String countryName;
  final String accentColor;
  final String notes;

  factory UserAssignment.fromJson(Map<String, dynamic> json) {
    return UserAssignment(
      id: (json['id'] as num).toInt(),
      unitId: (json['unit_id'] as num).toInt(),
      unitName: (json['unit_name'] as String?) ?? '',
      unitType: (json['unit_type'] as String?) ?? 'diocese',
      roleTitle: (json['role_title'] as String?) ?? '',
      startYear: (json['start_year'] as num?)?.toInt(),
      endYear: (json['end_year'] as num?)?.toInt(),
      isCurrent: (json['is_current'] as bool?) ?? true,
      isPrimary: (json['is_primary'] as bool?) ?? false,
      city: (json['city'] as String?) ?? '',
      countryCode: (json['country_code'] as String?) ?? '',
      countryName: (json['country_name'] as String?) ?? '',
      accentColor: (json['accent_color'] as String?) ?? '#6B2D5C',
      notes: (json['notes'] as String?) ?? '',
    );
  }
}

class CredoUser {
  const CredoUser({
    required this.id,
    required this.username,
    required this.fullName,
    this.titlePrefix = '',
    required this.ecclesiasticalRank,
    required this.canPublish,
    this.religiousOrderInitials = '',
    this.primaryUnitId,
    this.religiousOrderId,
    this.currentOfficeTitle = '',
    this.bio = '',
    this.motto = '',
    this.ordinationDate,
    this.countryCode = '',
    this.languages = const ['es'],
    this.preferredLocale = 'es',
    this.avatarColor = '#7A1C2E',
    this.verificationStatus = 'unverified',
    this.isAdmin = false,
    this.lineage = const [],
    this.religiousOrder,
    this.followersCount = 0,
    this.followingCount = 0,
    this.postsCount = 0,
    this.isFollowing = false,
  });

  final int id;
  final String username;
  final String fullName;
  final String titlePrefix;
  final String ecclesiasticalRank;
  final bool canPublish;
  final String religiousOrderInitials;
  final int? primaryUnitId;
  final int? religiousOrderId;
  final String currentOfficeTitle;
  final String bio;
  final String motto;
  final String? ordinationDate;
  final String countryCode;
  final List<String> languages;
  final String preferredLocale;
  final String avatarColor;
  final String verificationStatus;
  final bool isAdmin;
  final List<EcclesiasticalUnit> lineage;
  final EcclesiasticalUnit? religiousOrder;
  final int followersCount;
  final int followingCount;
  final int postsCount;
  final bool isFollowing;

  bool get isVerified => verificationStatus == 'verified';

  String get displayName {
    final parts = <String>[];
    if (titlePrefix.isNotEmpty) parts.add(titlePrefix);
    parts.add(fullName);
    if (religiousOrderInitials.isNotEmpty) {
      parts.add(', $religiousOrderInitials');
    }
    return parts.join(' ').replaceAll(' ,', ',');
  }

  String get initials {
    final parts = fullName.trim().split(RegExp(r'\s+'));
    if (parts.isEmpty) return 'C';
    if (parts.length == 1) return parts.first.substring(0, 1).toUpperCase();
    return '${parts.first[0]}${parts.last[0]}'.toUpperCase();
  }

  EcclesiasticalUnit? get primaryUnit =>
      lineage.isNotEmpty ? lineage.last : null;

  factory CredoUser.fromJson(Map<String, dynamic> json) {
    final rawLineage = json['lineage'] as List<dynamic>? ?? const [];
    final rawOrder = json['religious_order'] as Map<String, dynamic>?;
    final rawLangs = json['languages'] as List<dynamic>? ?? const ['es'];
    return CredoUser(
      id: (json['id'] as num).toInt(),
      username: (json['username'] as String?) ?? '',
      fullName: (json['full_name'] as String?) ?? '',
      titlePrefix: (json['title_prefix'] as String?) ?? '',
      ecclesiasticalRank: (json['ecclesiastical_rank'] as String?) ?? 'lay',
      canPublish: (json['can_publish'] as bool?) ?? false,
      religiousOrderInitials:
          (json['religious_order_initials'] as String?) ?? '',
      primaryUnitId: (json['primary_unit_id'] as num?)?.toInt(),
      religiousOrderId: (json['religious_order_id'] as num?)?.toInt(),
      currentOfficeTitle: (json['current_office_title'] as String?) ?? '',
      bio: (json['bio'] as String?) ?? '',
      motto: (json['motto'] as String?) ?? '',
      ordinationDate: json['ordination_date'] as String?,
      countryCode: (json['country_code'] as String?) ?? '',
      languages: rawLangs.map((e) => e.toString()).toList(),
      preferredLocale: (json['preferred_locale'] as String?) ?? 'es',
      avatarColor: (json['avatar_color'] as String?) ?? '#7A1C2E',
      verificationStatus:
          (json['verification_status'] as String?) ?? 'unverified',
      isAdmin: (json['is_admin'] as bool?) ?? false,
      lineage: rawLineage
          .map((e) => EcclesiasticalUnit.fromJson(e as Map<String, dynamic>))
          .toList(),
      religiousOrder:
          rawOrder != null ? EcclesiasticalUnit.fromJson(rawOrder) : null,
      followersCount: (json['followers_count'] as num?)?.toInt() ?? 0,
      followingCount: (json['following_count'] as num?)?.toInt() ?? 0,
      postsCount: (json['posts_count'] as num?)?.toInt() ?? 0,
      isFollowing: (json['is_following'] as bool?) ?? false,
    );
  }
}
