import 'package:flutter/material.dart';
import '../../../domain/models/credo_user.dart';
import '../../../domain/models/ecclesiastical_unit.dart';
import '../../../l10n/generated/app_localizations.dart';
import '../../../state/app_controller.dart';
import '../../core/labels.dart';
import '../../core/theme.dart';
import '../../core/widgets/lineage_breadcrumbs.dart';
import '../../core/widgets/rank_badge.dart';
import '../../core/widgets/user_avatar.dart';

class DirectoryView extends StatefulWidget {
  const DirectoryView({
    super.key,
    required this.controller,
    required this.onOpenProfile,
    required this.onOpenUnit,
  });

  final AppController controller;
  final void Function(int userId) onOpenProfile;
  final void Function(int unitId) onOpenUnit;

  @override
  State<DirectoryView> createState() => _DirectoryViewState();
}

class _DirectoryViewState extends State<DirectoryView>
    with SingleTickerProviderStateMixin {
  late final TabController _tabController;
  final _searchCtrl = TextEditingController();

  String _query = '';
  String? _selectedRank;
  bool _clergyOnly = false;
  bool _verifiedOnly = false;
  String? _selectedUnitType;

  List<CredoUser> _users = const [];
  List<EcclesiasticalUnit> _units = const [];
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 2, vsync: this);
    _load();
  }

  @override
  void dispose() {
    _tabController.dispose();
    _searchCtrl.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() => _loading = true);
    try {
      final results = await Future.wait([
        widget.controller.api.searchUsers(
          query: _query,
          rank: _selectedRank,
          clergyOnly: _clergyOnly,
          verifiedOnly: _verifiedOnly,
        ),
        widget.controller.api.searchUnits(
          query: _query,
          unitType: _selectedUnitType,
        ),
      ]);
      if (mounted) {
        setState(() {
          _users = results[0] as List<CredoUser>;
          _units = results[1] as List<EcclesiasticalUnit>;
          _loading = false;
        });
      }
    } catch (_) {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);

    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                l10n.directoryTitle,
                style: Theme.of(context).textTheme.headlineSmall,
              ),
              const SizedBox(height: 10),
              TextField(
                controller: _searchCtrl,
                decoration: InputDecoration(
                  hintText: l10n.searchDirectoryHint,
                  prefixIcon: const Icon(Icons.search_rounded),
                  suffixIcon: _query.isNotEmpty
                      ? IconButton(
                          icon: const Icon(Icons.clear_rounded),
                          onPressed: () {
                            _searchCtrl.clear();
                            setState(() => _query = '');
                            _load();
                          },
                        )
                      : null,
                ),
                onSubmitted: (_) => _load(),
                onChanged: (v) {
                  _query = v;
                  _load();
                },
              ),
              const SizedBox(height: 10),
              TabBar(
                controller: _tabController,
                labelColor: CredoColors.cardinal,
                indicatorColor: CredoColors.cardinal,
                tabs: [
                  Tab(text: '${l10n.tabPeople} (${_users.length})'),
                  Tab(text: '${l10n.tabInstitutions} (${_units.length})'),
                ],
              ),
            ],
          ),
        ),
        Expanded(
          child: TabBarView(
            controller: _tabController,
            children: [
              _buildPeopleTab(context, l10n),
              _buildInstitutionsTab(context, l10n),
            ],
          ),
        ),
      ],
    );
  }

  Widget _buildPeopleTab(BuildContext context, AppLocalizations l10n) {
    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 8, 16, 88),
      children: [
        SingleChildScrollView(
          scrollDirection: Axis.horizontal,
          child: Row(
            children: [
              FilterChip(
                label: Text(l10n.filterClergyOnly),
                selected: _clergyOnly,
                onSelected: (v) {
                  setState(() {
                    _clergyOnly = v;
                    if (v) _selectedRank = null;
                  });
                  _load();
                },
              ),
              const SizedBox(width: 6),
              FilterChip(
                label: Text(l10n.filterVerifiedOnly),
                selected: _verifiedOnly,
                onSelected: (v) {
                  setState(() => _verifiedOnly = v);
                  _load();
                },
              ),
              const SizedBox(width: 6),
              for (final r in const [
                'cardinal',
                'archbishop',
                'bishop',
                'priest',
                'deacon',
                'religious',
                'lay',
              ]) ...[
                ChoiceChip(
                  label: Text(rankLabel(l10n, r)),
                  selected: _selectedRank == r,
                  onSelected: (_) {
                    setState(() {
                      _selectedRank = _selectedRank == r ? null : r;
                      if (_selectedRank != null) _clergyOnly = false;
                    });
                    _load();
                  },
                ),
                const SizedBox(width: 6),
              ],
            ],
          ),
        ),
        const SizedBox(height: 12),
        if (_loading)
          const Padding(
            padding: EdgeInsets.all(40),
            child: Center(child: CircularProgressIndicator()),
          )
        else if (_users.isEmpty)
          Card(
            child: Padding(
              padding: const EdgeInsets.all(28),
              child: Center(child: Text(l10n.noResults)),
            ),
          )
        else
          for (final u in _users) ...[
            Card(
              child: InkWell(
                onTap: () => widget.onOpenProfile(u.id),
                borderRadius: BorderRadius.circular(16),
                child: Padding(
                  padding: const EdgeInsets.all(14),
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      UserAvatar(user: u, radius: 24),
                      const SizedBox(width: 12),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Wrap(
                              spacing: 8,
                              runSpacing: 4,
                              crossAxisAlignment: WrapCrossAlignment.center,
                              children: [
                                Text(
                                  u.displayName,
                                  style:
                                      Theme.of(context).textTheme.titleMedium,
                                ),
                                RankBadge(
                                  rank: u.ecclesiasticalRank,
                                  isVerified: u.isVerified,
                                  compact: true,
                                ),
                              ],
                            ),
                            if (u.currentOfficeTitle.isNotEmpty) ...[
                              const SizedBox(height: 3),
                              Text(
                                '${countryFlag(u.countryCode)} ${u.currentOfficeTitle}',
                                style: Theme.of(context).textTheme.bodySmall,
                              ),
                            ],
                            if (u.lineage.isNotEmpty) ...[
                              const SizedBox(height: 8),
                              LineageBreadcrumbs(
                                lineage: u.lineage.length > 3
                                    ? u.lineage.sublist(u.lineage.length - 3)
                                    : u.lineage,
                                onTapUnit: widget.onOpenUnit,
                                compact: true,
                              ),
                            ],
                          ],
                        ),
                      ),
                      const Icon(Icons.chevron_right_rounded,
                          color: CredoColors.mutedInk),
                    ],
                  ),
                ),
              ),
            ),
            const SizedBox(height: 10),
          ],
      ],
    );
  }

  Widget _buildInstitutionsTab(BuildContext context, AppLocalizations l10n) {
    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 8, 16, 88),
      children: [
        SingleChildScrollView(
          scrollDirection: Axis.horizontal,
          child: Row(
            children: [
              ChoiceChip(
                label: Text(l10n.scopeGlobal),
                selected: _selectedUnitType == null,
                onSelected: (_) {
                  setState(() => _selectedUnitType = null);
                  _load();
                },
              ),
              const SizedBox(width: 6),
              for (final t in kUnitTypes) ...[
                ChoiceChip(
                  label: Text(unitTypeLabel(l10n, t)),
                  selected: _selectedUnitType == t,
                  onSelected: (_) {
                    setState(() =>
                        _selectedUnitType = _selectedUnitType == t ? null : t);
                    _load();
                  },
                ),
                const SizedBox(width: 6),
              ],
            ],
          ),
        ),
        const SizedBox(height: 12),
        if (_loading)
          const Padding(
            padding: EdgeInsets.all(40),
            child: Center(child: CircularProgressIndicator()),
          )
        else if (_units.isEmpty)
          Card(
            child: Padding(
              padding: const EdgeInsets.all(28),
              child: Center(child: Text(l10n.noResults)),
            ),
          )
        else
          for (final unit in _units) ...[
            Card(
              child: InkWell(
                onTap: () => widget.onOpenUnit(unit.id),
                borderRadius: BorderRadius.circular(16),
                child: Padding(
                  padding: const EdgeInsets.all(14),
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      CircleAvatar(
                        radius: 22,
                        backgroundColor: parseHexColor(unit.accentColor)
                            .withValues(alpha: 0.14),
                        child: Icon(
                          unitTypeIcon(unit.unitType),
                          color: parseHexColor(unit.accentColor),
                          size: 20,
                        ),
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              unit.name,
                              style: Theme.of(context).textTheme.titleMedium,
                            ),
                            const SizedBox(height: 3),
                            Text(
                              '${countryFlag(unit.countryCode)} ${unitTypeLabel(l10n, unit.unitType)}'
                              '${unit.city.isNotEmpty ? ' · ${unit.city}' : ''}'
                              '${unit.countryName.isNotEmpty ? ', ${unit.countryName}' : ''}',
                              style: Theme.of(context).textTheme.bodySmall,
                            ),
                            if (unit.lineage.length > 1) ...[
                              const SizedBox(height: 6),
                              LineageBreadcrumbs(
                                lineage: unit.lineage.sublist(
                                  0,
                                  unit.lineage.length - 1,
                                ),
                                onTapUnit: widget.onOpenUnit,
                                compact: true,
                              ),
                            ],
                          ],
                        ),
                      ),
                      const Icon(Icons.chevron_right_rounded,
                          color: CredoColors.mutedInk),
                    ],
                  ),
                ),
              ),
            ),
            const SizedBox(height: 10),
          ],
      ],
    );
  }
}
