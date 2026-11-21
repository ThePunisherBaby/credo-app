import 'dart:ui';
import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../data/services/credo_api_service.dart';
import '../domain/models/credo_user.dart';
import '../domain/models/ecclesiastical_unit.dart';

class AppController extends ChangeNotifier {
  AppController({CredoApiService? api}) : api = api ?? CredoApiService();

  static const _tokenKey = 'credo_jwt_token';
  static const _localeKey = 'credo_locale';
  static const supportedLanguageCodes = ['es', 'en', 'it', 'pt', 'fr'];

  final CredoApiService api;

  bool _initialized = false;
  bool get initialized => _initialized;

  CredoUser? _currentUser;
  CredoUser? get currentUser => _currentUser;
  bool get isAuthenticated => _currentUser != null;
  bool get canPublish => _currentUser?.canPublish ?? false;

  Locale _locale = const Locale('es');
  Locale get locale => _locale;

  List<EcclesiasticalUnit> _allUnits = const [];
  List<EcclesiasticalUnit> get allUnits => _allUnits;

  CredoStats _stats = const CredoStats();
  CredoStats get stats => _stats;

  int _dataVersion = 0;
  int get dataVersion => _dataVersion;

  Future<void> initialize() async {
    final prefs = await SharedPreferences.getInstance();

    // Detect or restore locale
    final savedLocale = prefs.getString(_localeKey);
    if (savedLocale != null && supportedLanguageCodes.contains(savedLocale)) {
      _locale = Locale(savedLocale);
    } else {
      final sysCode = PlatformDispatcher.instance.locale.languageCode;
      _locale = supportedLanguageCodes.contains(sysCode)
          ? Locale(sysCode)
          : const Locale('es');
    }

    // Restore session if present
    final savedToken = prefs.getString(_tokenKey);
    if (savedToken != null && savedToken.isNotEmpty) {
      api.setToken(savedToken);
      try {
        _currentUser = await api.fetchMe();
      } catch (_) {
        api.setToken(null);
        await prefs.remove(_tokenKey);
      }
    }

    await refreshGlobalData();
    _initialized = true;
    notifyListeners();
  }

  Future<void> refreshGlobalData() async {
    try {
      final results = await Future.wait([
        api.fetchUnitsTree(),
        api.fetchStats(),
      ]);
      _allUnits = results[0] as List<EcclesiasticalUnit>;
      _stats = results[1] as CredoStats;
      notifyListeners();
    } catch (e) {
      debugPrint('[AppController] refreshGlobalData failed: $e');
    }
  }

  void bumpDataVersion() {
    _dataVersion++;
    notifyListeners();
  }

  Future<void> setLocale(String languageCode) async {
    if (!supportedLanguageCodes.contains(languageCode)) return;
    _locale = Locale(languageCode);
    notifyListeners();
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_localeKey, languageCode);
    if (_currentUser != null) {
      try {
        await api.updateMyProfile(preferredLocale: languageCode);
      } catch (_) {}
    }
  }

  Future<void> login(String identifier, String password) async {
    final res = await api.login(identifier: identifier, password: password);
    api.setToken(res.token);
    _currentUser = res.user;
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_tokenKey, res.token);
    bumpDataVersion();
  }

  Future<void> register({
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
  }) async {
    final res = await api.register(
      email: email,
      password: password,
      fullName: fullName,
      username: username,
      ecclesiasticalRank: ecclesiasticalRank,
      titlePrefix: titlePrefix,
      primaryUnitId: primaryUnitId,
      religiousOrderId: religiousOrderId,
      religiousOrderInitials: religiousOrderInitials,
      currentOfficeTitle: currentOfficeTitle,
      bio: bio,
      motto: motto,
      countryCode: countryCode,
      preferredLocale: _locale.languageCode,
    );
    api.setToken(res.token);
    _currentUser = res.user;
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_tokenKey, res.token);
    await refreshGlobalData();
    bumpDataVersion();
  }

  Future<void> reloadCurrentUser() async {
    if (_currentUser == null) return;
    try {
      _currentUser = await api.fetchMe();
      notifyListeners();
    } catch (_) {}
  }

  Future<void> logout() async {
    api.setToken(null);
    _currentUser = null;
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove(_tokenKey);
    bumpDataVersion();
  }

  List<EcclesiasticalUnit> childrenOf(int? parentId) {
    return _allUnits.where((u) => u.parentId == parentId).toList();
  }

  EcclesiasticalUnit? unitById(int? id) {
    if (id == null) return null;
    for (final u in _allUnits) {
      if (u.id == id) return u;
    }
    return null;
  }
}
