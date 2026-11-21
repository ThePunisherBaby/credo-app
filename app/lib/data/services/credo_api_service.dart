import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;

import '../../domain/models/conversation.dart';
import '../../domain/models/credo_post.dart';
import '../../domain/models/credo_user.dart';
import '../../domain/models/ecclesiastical_unit.dart';

class ApiException implements Exception {
  ApiException(this.message, {this.statusCode, this.code});
  final String message;
  final int? statusCode;
  final String? code;

  @override
  String toString() => message;
}

class UnitDetailResponse {
  const UnitDetailResponse({
    required this.unit,
    required this.children,
    required this.members,
  });

  final EcclesiasticalUnit unit;
  final List<EcclesiasticalUnit> children;
  final List<CredoUser> members;
}

class ProfileDetailResponse {
  const ProfileDetailResponse({
    required this.user,
    required this.assignments,
  });

  final CredoUser user;
  final List<UserAssignment> assignments;
}

class CredoStats {
  const CredoStats({
    this.units = 0,
    this.countries = 0,
    this.clergy = 0,
    this.members = 0,
    this.posts = 0,
  });

  final int units;
  final int countries;
  final int clergy;
  final int members;
  final int posts;

  factory CredoStats.fromJson(Map<String, dynamic> json) {
    return CredoStats(
      units: (json['units'] as num?)?.toInt() ?? 0,
      countries: (json['countries'] as num?)?.toInt() ?? 0,
      clergy: (json['clergy'] as num?)?.toInt() ?? 0,
      members: (json['members'] as num?)?.toInt() ?? 0,
      posts: (json['posts'] as num?)?.toInt() ?? 0,
    );
  }
}

class CredoApiService {
  CredoApiService({http.Client? client, String? baseUrl})
      : _client = client ?? http.Client(),
        baseUrl = baseUrl ?? _resolveBaseUrl();

  final http.Client _client;
  final String baseUrl;
  String? _token;

  static const String _definedApiUrl = String.fromEnvironment('CREDO_API_URL');

  static String _resolveBaseUrl() {
    if (_definedApiUrl.isNotEmpty) {
      return _definedApiUrl.replaceAll(RegExp(r'/$'), '');
    }
    if (kIsWeb) {
      final origin = Uri.base.origin;
      if (origin.startsWith('http://localhost:') ||
          origin.startsWith('http://127.0.0.1:')) {
        // When running flutter run -d chrome locally against port 8080 backend:
        if (Uri.base.port != 8080) {
          return 'http://127.0.0.1:8080';
        }
      }
      return origin;
    }
    return 'https://credoapp.tech';
  }

  void setToken(String? token) {
    _token = token;
  }

  Map<String, String> _headers() {
    final map = <String, String>{
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    };
    if (_token != null && _token!.isNotEmpty) {
      map['Authorization'] = 'Bearer $_token';
    }
    return map;
  }

  Uri _uri(String path, [Map<String, String>? query]) {
    final uri = Uri.parse('$baseUrl$path');
    if (query == null || query.isEmpty) return uri;
    final filtered = <String, String>{};
    query.forEach((k, v) {
      if (v.isNotEmpty) filtered[k] = v;
    });
    return uri.replace(queryParameters: filtered.isEmpty ? null : filtered);
  }

  Map<String, dynamic> _decode(http.Response res) {
    Map<String, dynamic> body = {};
    if (res.body.isNotEmpty) {
      try {
        final decoded = jsonDecode(res.body);
        if (decoded is Map<String, dynamic>) body = decoded;
      } catch (_) {}
    }
    if (res.statusCode >= 400) {
      final msg = (body['message'] as String?) ??
          (body['error'] as String?) ??
          'HTTP ${res.statusCode}';
      throw ApiException(
        msg,
        statusCode: res.statusCode,
        code: body['error'] as String?,
      );
    }
    return body;
  }

  // --- AUTH ---

  Future<({String token, CredoUser user})> login({
    required String identifier,
    required String password,
  }) async {
    final res = await _client.post(
      _uri('/api/v1/auth/login'),
      headers: _headers(),
      body: jsonEncode({'identifier': identifier, 'password': password}),
    );
    final data = _decode(res);
    return (
      token: data['token'] as String,
      user: CredoUser.fromJson(data['user'] as Map<String, dynamic>),
    );
  }

  Future<({String token, CredoUser user})> register({
    required String email,
    required String password,
    required String fullName,
    String? username,
    required String ecclesiasticalRank,
    String? titlePrefix,
    int? primaryUnitId,
    int? religiousOrderId,
    String? religiousOrderInitials,
    String? currentOfficeTitle,
    String? bio,
    String? motto,
    String? countryCode,
    String? preferredLocale,
  }) async {
    final res = await _client.post(
      _uri('/api/v1/auth/register'),
      headers: _headers(),
      body: jsonEncode({
        'email': email,
        'password': password,
        'full_name': fullName,
        if (username != null && username.isNotEmpty) 'username': username,
        'ecclesiastical_rank': ecclesiasticalRank,
        'title_prefix': ?titlePrefix,
        'primary_unit_id': ?primaryUnitId,
        'religious_order_id': ?religiousOrderId,
        'religious_order_initials': ?religiousOrderInitials,
        'current_office_title': ?currentOfficeTitle,
        'bio': ?bio,
        'motto': ?motto,
        'country_code': ?countryCode,
        'preferred_locale': ?preferredLocale,
      }),
    );
    final data = _decode(res);
    return (
      token: data['token'] as String,
      user: CredoUser.fromJson(data['user'] as Map<String, dynamic>),
    );
  }

  Future<CredoUser> fetchMe() async {
    final res = await _client.get(_uri('/api/v1/auth/me'), headers: _headers());
    final data = _decode(res);
    return CredoUser.fromJson(data['user'] as Map<String, dynamic>);
  }

  // --- STATS ---

  Future<CredoStats> fetchStats() async {
    final res = await _client.get(_uri('/api/v1/stats'), headers: _headers());
    return CredoStats.fromJson(_decode(res));
  }

  // --- ECCLESIASTICAL UNITS ---

  Future<List<EcclesiasticalUnit>> fetchUnitsTree() async {
    final res =
        await _client.get(_uri('/api/v1/units/tree'), headers: _headers());
    final data = _decode(res);
    final list = data['units'] as List<dynamic>? ?? const [];
    return list
        .map((e) => EcclesiasticalUnit.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  Future<List<EcclesiasticalUnit>> searchUnits({
    int? parentId,
    bool rootOnly = false,
    String? unitType,
    String? countryCode,
    String? query,
  }) async {
    final res = await _client.get(
      _uri('/api/v1/units', {
        if (parentId != null) 'parent_id': '$parentId',
        if (rootOnly) 'root_only': 'true',
        if (unitType != null && unitType.isNotEmpty) 'unit_type': unitType,
        if (countryCode != null && countryCode.isNotEmpty)
          'country_code': countryCode,
        if (query != null && query.isNotEmpty) 'q': query,
      }),
      headers: _headers(),
    );
    final data = _decode(res);
    final list = data['units'] as List<dynamic>? ?? const [];
    return list
        .map((e) => EcclesiasticalUnit.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  Future<UnitDetailResponse> fetchUnitDetail(int unitId) async {
    final res =
        await _client.get(_uri('/api/v1/units/$unitId'), headers: _headers());
    final data = _decode(res);
    return UnitDetailResponse(
      unit: EcclesiasticalUnit.fromJson(data['unit'] as Map<String, dynamic>),
      children: (data['children'] as List<dynamic>? ?? const [])
          .map((e) => EcclesiasticalUnit.fromJson(e as Map<String, dynamic>))
          .toList(),
      members: (data['members'] as List<dynamic>? ?? const [])
          .map((e) => CredoUser.fromJson(e as Map<String, dynamic>))
          .toList(),
    );
  }

  Future<EcclesiasticalUnit> createUnit({
    required String name,
    required String unitType,
    required int parentId,
    String officialLatinName = '',
    String countryCode = '',
    String countryName = '',
    String city = '',
    String patronSaint = '',
    int? foundedYear,
    String description = '',
  }) async {
    final res = await _client.post(
      _uri('/api/v1/units'),
      headers: _headers(),
      body: jsonEncode({
        'name': name,
        'unit_type': unitType,
        'parent_id': parentId,
        'official_latin_name': officialLatinName,
        'country_code': countryCode,
        'country_name': countryName,
        'city': city,
        'patron_saint': patronSaint,
        'founded_year': ?foundedYear,
        'description': description,
      }),
    );
    final data = _decode(res);
    return EcclesiasticalUnit.fromJson(data['unit'] as Map<String, dynamic>);
  }

  Future<bool> toggleFollowUnit(int unitId, {required bool follow}) async {
    final uri = _uri('/api/v1/units/$unitId/follow');
    final res = follow
        ? await _client.post(uri, headers: _headers())
        : await _client.delete(uri, headers: _headers());
    final data = _decode(res);
    return (data['following'] as bool?) ?? follow;
  }

  // --- USERS / DIRECTORY / PROFILES ---

  Future<List<CredoUser>> searchUsers({
    String? query,
    String? rank,
    bool clergyOnly = false,
    bool verifiedOnly = false,
    String? countryCode,
    int? unitId,
  }) async {
    final res = await _client.get(
      _uri('/api/v1/users', {
        if (query != null && query.isNotEmpty) 'q': query,
        if (rank != null && rank.isNotEmpty) 'rank': rank,
        if (clergyOnly) 'clergy_only': 'true',
        if (verifiedOnly) 'verified_only': 'true',
        if (countryCode != null && countryCode.isNotEmpty)
          'country_code': countryCode,
        if (unitId != null) 'unit_id': '$unitId',
      }),
      headers: _headers(),
    );
    final data = _decode(res);
    final list = data['users'] as List<dynamic>? ?? const [];
    return list
        .map((e) => CredoUser.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  Future<ProfileDetailResponse> fetchUserProfile(int userId) async {
    final res =
        await _client.get(_uri('/api/v1/users/$userId'), headers: _headers());
    final data = _decode(res);
    return ProfileDetailResponse(
      user: CredoUser.fromJson(data['user'] as Map<String, dynamic>),
      assignments: (data['assignments'] as List<dynamic>? ?? const [])
          .map((e) => UserAssignment.fromJson(e as Map<String, dynamic>))
          .toList(),
    );
  }

  Future<CredoUser> updateMyProfile({
    String? fullName,
    String? titlePrefix,
    String? currentOfficeTitle,
    int? primaryUnitId,
    int? religiousOrderId,
    String? religiousOrderInitials,
    String? bio,
    String? motto,
    String? preferredLocale,
    bool? requestVerification,
  }) async {
    final res = await _client.put(
      _uri('/api/v1/users/me'),
      headers: _headers(),
      body: jsonEncode({
        'full_name': ?fullName,
        'title_prefix': ?titlePrefix,
        'current_office_title': ?currentOfficeTitle,
        'primary_unit_id': ?primaryUnitId,
        'religious_order_id': ?religiousOrderId,
        'religious_order_initials': ?religiousOrderInitials,
        'bio': ?bio,
        'motto': ?motto,
        'preferred_locale': ?preferredLocale,
        'request_verification': ?requestVerification,
      }),
    );
    final data = _decode(res);
    return CredoUser.fromJson(data['user'] as Map<String, dynamic>);
  }

  Future<void> addAssignment({
    required int unitId,
    required String roleTitle,
    int? startYear,
    int? endYear,
    bool isCurrent = true,
    bool isPrimary = false,
  }) async {
    final res = await _client.post(
      _uri('/api/v1/users/me/assignments'),
      headers: _headers(),
      body: jsonEncode({
        'unit_id': unitId,
        'role_title': roleTitle,
        'start_year': ?startYear,
        'end_year': ?endYear,
        'is_current': isCurrent,
        'is_primary': isPrimary,
      }),
    );
    _decode(res);
  }

  Future<void> deleteAssignment(int assignmentId) async {
    final res = await _client.delete(
      _uri('/api/v1/users/me/assignments/$assignmentId'),
      headers: _headers(),
    );
    _decode(res);
  }

  Future<void> verifyUser(int userId, {String status = 'verified'}) async {
    final res = await _client.post(
      _uri('/api/v1/users/$userId/verify'),
      headers: _headers(),
      body: jsonEncode({'status': status}),
    );
    _decode(res);
  }

  Future<bool> toggleFollowUser(int userId, {required bool follow}) async {
    final uri = _uri('/api/v1/users/$userId/follow');
    final res = follow
        ? await _client.post(uri, headers: _headers())
        : await _client.delete(uri, headers: _headers());
    final data = _decode(res);
    return (data['following'] as bool?) ?? follow;
  }

  // --- POSTS / FEED ---

  Future<({List<CredoPost> posts, EcclesiasticalUnit? resolvedScope})>
      fetchPosts({
    String scope = 'global',
    int? unitId,
    int? authorId,
    String? postType,
    String? query,
  }) async {
    final res = await _client.get(
      _uri('/api/v1/posts', {
        'scope': scope,
        if (unitId != null) 'unit_id': '$unitId',
        if (authorId != null) 'author_id': '$authorId',
        if (postType != null && postType.isNotEmpty) 'post_type': postType,
        if (query != null && query.isNotEmpty) 'q': query,
      }),
      headers: _headers(),
    );
    final data = _decode(res);
    final rawScope = data['resolved_scope_unit'] as Map<String, dynamic>?;
    return (
      posts: (data['posts'] as List<dynamic>? ?? const [])
          .map((e) => CredoPost.fromJson(e as Map<String, dynamic>))
          .toList(),
      resolvedScope:
          rawScope != null ? EcclesiasticalUnit.fromJson(rawScope) : null,
    );
  }

  Future<CredoPost> createPost({
    required String content,
    String title = '',
    String postType = 'reflection',
    int? scopeUnitId,
    String scriptureRef = '',
    String eventLocation = '',
    String language = 'es',
  }) async {
    final res = await _client.post(
      _uri('/api/v1/posts'),
      headers: _headers(),
      body: jsonEncode({
        'content': content,
        'title': title,
        'post_type': postType,
        'scope_unit_id': ?scopeUnitId,
        'scripture_ref': scriptureRef,
        'event_location': eventLocation,
        'language': language,
      }),
    );
    final data = _decode(res);
    return CredoPost.fromJson(data['post'] as Map<String, dynamic>);
  }

  Future<void> deletePost(int postId) async {
    final res = await _client.delete(
      _uri('/api/v1/posts/$postId'),
      headers: _headers(),
    );
    _decode(res);
  }

  Future<({bool active, Map<String, int> reactions})> toggleReaction(
    int postId,
    String reactionType,
  ) async {
    final res = await _client.post(
      _uri('/api/v1/posts/$postId/react'),
      headers: _headers(),
      body: jsonEncode({'reaction_type': reactionType}),
    );
    final data = _decode(res);
    final raw = data['reactions'] as Map<String, dynamic>? ?? const {};
    return (
      active: (data['active'] as bool?) ?? false,
      reactions: {
        'amen': (raw['amen'] as num?)?.toInt() ?? 0,
        'pray': (raw['pray'] as num?)?.toInt() ?? 0,
        'gratitude': (raw['gratitude'] as num?)?.toInt() ?? 0,
      },
    );
  }

  Future<List<CredoComment>> fetchComments(int postId) async {
    final res = await _client.get(
      _uri('/api/v1/posts/$postId/comments'),
      headers: _headers(),
    );
    final data = _decode(res);
    return (data['comments'] as List<dynamic>? ?? const [])
        .map((e) => CredoComment.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  Future<CredoComment> addComment(int postId, String content) async {
    final res = await _client.post(
      _uri('/api/v1/posts/$postId/comments'),
      headers: _headers(),
      body: jsonEncode({'content': content}),
    );
    final data = _decode(res);
    return CredoComment.fromJson(data['comment'] as Map<String, dynamic>);
  }

  // --- CONVERSATIONS & MESSAGES ---

  Future<List<CredoConversation>> fetchConversations() async {
    final res = await _client.get(
      _uri('/api/v1/conversations'),
      headers: _headers(),
    );
    final data = _decode(res);
    return (data['conversations'] as List<dynamic>? ?? const [])
        .map((e) => CredoConversation.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  Future<List<CredoConversation>> discoverPastoralGroups({String? query}) async {
    final res = await _client.get(
      _uri('/api/v1/conversations/discover', {
        if (query != null && query.isNotEmpty) 'q': query,
      }),
      headers: _headers(),
    );
    final data = _decode(res);
    return (data['groups'] as List<dynamic>? ?? const [])
        .map((e) => CredoConversation.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  Future<int> startDirectChat(int targetUserId) async {
    final res = await _client.post(
      _uri('/api/v1/conversations/direct'),
      headers: _headers(),
      body: jsonEncode({'target_user_id': targetUserId}),
    );
    final data = _decode(res);
    return (data['conversation_id'] as num).toInt();
  }

  Future<CredoConversation> createPastoralGroup({
    required String title,
    String description = '',
    int? unitId,
  }) async {
    final res = await _client.post(
      _uri('/api/v1/conversations/groups'),
      headers: _headers(),
      body: jsonEncode({
        'title': title,
        'description': description,
        'unit_id': ?unitId,
      }),
    );
    final data = _decode(res);
    return CredoConversation.fromJson(
      data['conversation'] as Map<String, dynamic>,
    );
  }

  Future<void> joinGroup(int conversationId) async {
    final res = await _client.post(
      _uri('/api/v1/conversations/$conversationId/join'),
      headers: _headers(),
    );
    _decode(res);
  }

  Future<List<CredoMessage>> fetchMessages(int conversationId) async {
    final res = await _client.get(
      _uri('/api/v1/conversations/$conversationId/messages'),
      headers: _headers(),
    );
    final data = _decode(res);
    return (data['messages'] as List<dynamic>? ?? const [])
        .map((e) => CredoMessage.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  Future<CredoMessage> sendMessage(int conversationId, String content) async {
    final res = await _client.post(
      _uri('/api/v1/conversations/$conversationId/messages'),
      headers: _headers(),
      body: jsonEncode({'content': content}),
    );
    final data = _decode(res);
    return CredoMessage.fromJson(data['message'] as Map<String, dynamic>);
  }
}
