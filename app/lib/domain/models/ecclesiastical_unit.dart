class EcclesiasticalUnit {
  const EcclesiasticalUnit({
    required this.id,
    required this.slug,
    required this.name,
    this.officialLatinName = '',
    required this.unitType,
    this.parentId,
    this.countryCode = '',
    this.countryName = '',
    this.city = '',
    this.rite = 'Latin',
    this.patronSaint = '',
    this.motto = '',
    this.address = '',
    this.website = '',
    this.foundedYear,
    this.description = '',
    this.accentColor = '#7A1C2E',
    this.verified = true,
    this.childrenCount = 0,
    this.membersCount = 0,
    this.followersCount = 0,
    this.totalDescendantsCount = 0,
    this.isFollowing = false,
    this.lineage = const [],
    this.pastoralGroupId,
    this.pastoralGroupTitle,
  });

  final int id;
  final String slug;
  final String name;
  final String officialLatinName;
  final String unitType;
  final int? parentId;
  final String countryCode;
  final String countryName;
  final String city;
  final String rite;
  final String patronSaint;
  final String motto;
  final String address;
  final String website;
  final int? foundedYear;
  final String description;
  final String accentColor;
  final bool verified;
  final int childrenCount;
  final int membersCount;
  final int followersCount;
  final int totalDescendantsCount;
  final bool isFollowing;
  final List<EcclesiasticalUnit> lineage;
  final int? pastoralGroupId;
  final String? pastoralGroupTitle;

  factory EcclesiasticalUnit.fromJson(Map<String, dynamic> json) {
    final rawLineage = json['lineage'] as List<dynamic>? ?? const [];
    final pastoralGroup = json['pastoral_group'] as Map<String, dynamic>?;
    return EcclesiasticalUnit(
      id: (json['id'] as num).toInt(),
      slug: (json['slug'] as String?) ?? '',
      name: (json['name'] as String?) ?? '',
      officialLatinName: (json['official_latin_name'] as String?) ?? '',
      unitType: (json['unit_type'] as String?) ?? 'diocese',
      parentId: (json['parent_id'] as num?)?.toInt(),
      countryCode: (json['country_code'] as String?) ?? '',
      countryName: (json['country_name'] as String?) ?? '',
      city: (json['city'] as String?) ?? '',
      rite: (json['rite'] as String?) ?? 'Latin',
      patronSaint: (json['patron_saint'] as String?) ?? '',
      motto: (json['motto'] as String?) ?? '',
      address: (json['address'] as String?) ?? '',
      website: (json['website'] as String?) ?? '',
      foundedYear: (json['founded_year'] as num?)?.toInt(),
      description: (json['description'] as String?) ?? '',
      accentColor: (json['accent_color'] as String?) ?? '#7A1C2E',
      verified: (json['verified'] as bool?) ?? true,
      childrenCount: (json['children_count'] as num?)?.toInt() ?? 0,
      membersCount:
          (json['members_count'] as num?)?.toInt() ??
          (json['direct_members_count'] as num?)?.toInt() ??
          0,
      followersCount: (json['followers_count'] as num?)?.toInt() ?? 0,
      totalDescendantsCount:
          (json['total_descendants_count'] as num?)?.toInt() ?? 0,
      isFollowing: (json['is_following'] as bool?) ?? false,
      lineage: rawLineage
          .map((e) => EcclesiasticalUnit.fromJson(e as Map<String, dynamic>))
          .toList(),
      pastoralGroupId: (pastoralGroup?['id'] as num?)?.toInt(),
      pastoralGroupTitle: pastoralGroup?['title'] as String?,
    );
  }
}
