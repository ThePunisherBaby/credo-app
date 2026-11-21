import 'package:flutter/material.dart';
import '../../../domain/models/ecclesiastical_unit.dart';
import '../../../l10n/generated/app_localizations.dart';
import '../../../state/app_controller.dart';
import '../../core/labels.dart';
import '../../core/theme.dart';
import '../../core/widgets/lineage_breadcrumbs.dart';

class HierarchyView extends StatefulWidget {
  const HierarchyView({
    super.key,
    required this.controller,
    required this.onOpenUnit,
  });

  final AppController controller;
  final void Function(int unitId) onOpenUnit;

  @override
  State<HierarchyView> createState() => _HierarchyViewState();
}

class _HierarchyViewState extends State<HierarchyView> {
  final _searchCtrl = TextEditingController();
  String _query = '';
  int? _currentParentId;

  @override
  void dispose() {
    _searchCtrl.dispose();
    super.dispose();
  }

  List<EcclesiasticalUnit> _buildTrail(List<EcclesiasticalUnit> all) {
    if (_currentParentId == null) return const [];
    final byId = {for (final u in all) u.id: u};
    final trail = <EcclesiasticalUnit>[];
    var cursor = byId[_currentParentId];
    int guard = 0;
    while (cursor != null && guard < 12) {
      trail.insert(0, cursor);
      cursor = cursor.parentId != null ? byId[cursor.parentId] : null;
      guard++;
    }
    return trail;
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final all = widget.controller.allUnits;
    final stats = widget.controller.stats;

    // Default to Santa Sede root if user hasn't navigated yet
    final rootUnit = all.where((u) => u.parentId == null).firstOrNull;
    final effectiveParentId = _currentParentId ?? rootUnit?.id;
    final trail = _buildTrail(all);
    final q = _query.trim().toLowerCase();

    final List<EcclesiasticalUnit> items;
    if (q.isNotEmpty) {
      items = all.where((u) {
        return u.name.toLowerCase().contains(q) ||
            u.countryName.toLowerCase().contains(q) ||
            u.city.toLowerCase().contains(q) ||
            u.officialLatinName.toLowerCase().contains(q) ||
            u.patronSaint.toLowerCase().contains(q);
      }).toList();
    } else {
      items = all.where((u) => u.parentId == effectiveParentId).toList();
    }

    // Group items visually by unitType when viewing Santa Sede root
    final currentUnit = effectiveParentId != null
        ? widget.controller.unitById(effectiveParentId)
        : null;

    return RefreshIndicator(
      onRefresh: widget.controller.refreshGlobalData,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 88),
        children: [
          // Header Card
          Container(
            padding: const EdgeInsets.all(20),
            decoration: BoxDecoration(
              gradient: const LinearGradient(
                colors: [Color(0xFF4A1935), CredoColors.cardinal],
                begin: Alignment.topLeft,
                end: Alignment.bottomRight,
              ),
              borderRadius: BorderRadius.circular(18),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  l10n.worldwideHierarchy,
                  style: Theme.of(context)
                      .textTheme
                      .headlineMedium
                      ?.copyWith(color: Colors.white),
                ),
                const SizedBox(height: 6),
                Text(
                  l10n.exploreHierarchySubtitle,
                  style: TextStyle(
                    color: Colors.white.withValues(alpha: 0.88),
                    fontSize: 13.5,
                  ),
                ),
                const SizedBox(height: 14),
                Wrap(
                  spacing: 12,
                  runSpacing: 8,
                  children: [
                    _StatBadge(
                      value: '${stats.units}',
                      label: l10n.unitsCount,
                    ),
                    _StatBadge(
                      value: '${stats.countries}',
                      label: l10n.countriesCount,
                    ),
                    _StatBadge(
                      value: '${stats.clergy}',
                      label: l10n.clergyCount,
                    ),
                  ],
                ),
              ],
            ),
          ),

          const SizedBox(height: 14),

          // Search Box
          TextField(
            controller: _searchCtrl,
            decoration: InputDecoration(
              hintText: l10n.searchHierarchy,
              prefixIcon: const Icon(Icons.search_rounded),
              suffixIcon: _query.isNotEmpty
                  ? IconButton(
                      icon: const Icon(Icons.clear_rounded),
                      onPressed: () {
                        _searchCtrl.clear();
                        setState(() => _query = '');
                      },
                    )
                  : null,
            ),
            onChanged: (v) => setState(() => _query = v),
          ),

          // Breadcrumb Trail when browsing tree
          if (q.isEmpty && currentUnit != null) ...[
            const SizedBox(height: 14),
            Card(
              child: Padding(
                padding: const EdgeInsets.all(14),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    LineageBreadcrumbs(
                      lineage: trail.isNotEmpty ? trail : [currentUnit],
                      onTapUnit: (id) => setState(() => _currentParentId = id),
                    ),
                    const SizedBox(height: 10),
                    Row(
                      children: [
                        Expanded(
                          child: Text(
                            '${countryFlag(currentUnit.countryCode)} ${currentUnit.name}',
                            style: Theme.of(context).textTheme.titleMedium,
                          ),
                        ),
                        TextButton.icon(
                          onPressed: () => widget.onOpenUnit(currentUnit.id),
                          icon: const Icon(Icons.open_in_new_rounded, size: 16),
                          label: Text(l10n.navProfile),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
            ),
          ],

          const SizedBox(height: 14),

          if (items.isEmpty)
            Card(
              child: Padding(
                padding: const EdgeInsets.all(28),
                child: Center(child: Text(l10n.noResults)),
              ),
            )
          else
            for (final u in items) ...[
              _HierarchyUnitTile(
                unit: u,
                onDrillDown: u.childrenCount > 0 && q.isEmpty
                    ? () => setState(() => _currentParentId = u.id)
                    : () => widget.onOpenUnit(u.id),
                onOpenDetail: () => widget.onOpenUnit(u.id),
              ),
              const SizedBox(height: 8),
            ],
        ],
      ),
    );
  }
}

class _StatBadge extends StatelessWidget {
  const _StatBadge({required this.value, required this.label});
  final String value;
  final String label;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
      decoration: BoxDecoration(
        color: Colors.white.withValues(alpha: 0.14),
        borderRadius: BorderRadius.circular(10),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(
            value,
            style: const TextStyle(
              color: CredoColors.vaticanGoldSoft,
              fontWeight: FontWeight.w800,
              fontSize: 15,
            ),
          ),
          const SizedBox(width: 6),
          Text(
            label,
            style: const TextStyle(
              color: Colors.white,
              fontSize: 12.5,
              fontWeight: FontWeight.w500,
            ),
          ),
        ],
      ),
    );
  }
}

class _HierarchyUnitTile extends StatelessWidget {
  const _HierarchyUnitTile({
    required this.unit,
    required this.onDrillDown,
    required this.onOpenDetail,
  });

  final EcclesiasticalUnit unit;
  final VoidCallback onDrillDown;
  final VoidCallback onOpenDetail;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final accent = parseHexColor(unit.accentColor);

    return Card(
      child: InkWell(
        onTap: onDrillDown,
        borderRadius: BorderRadius.circular(16),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
          child: Row(
            children: [
              CircleAvatar(
                radius: 22,
                backgroundColor: accent.withValues(alpha: 0.12),
                child: Icon(unitTypeIcon(unit.unitType),
                    color: accent, size: 22),
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
                    Wrap(
                      spacing: 8,
                      runSpacing: 4,
                      crossAxisAlignment: WrapCrossAlignment.center,
                      children: [
                        Text(
                          '${countryFlag(unit.countryCode)} ${unitTypeLabel(l10n, unit.unitType)}',
                          style: TextStyle(
                            fontSize: 12.5,
                            fontWeight: FontWeight.w600,
                            color: accent,
                          ),
                        ),
                        if (unit.city.isNotEmpty)
                          Text(
                            unit.city,
                            style: Theme.of(context).textTheme.bodySmall,
                          ),
                        if (unit.childrenCount > 0)
                          Container(
                            padding: const EdgeInsets.symmetric(
                                horizontal: 7, vertical: 2),
                            decoration: BoxDecoration(
                              color: CredoColors.warmTint,
                              borderRadius: BorderRadius.circular(999),
                            ),
                            child: Text(
                              '${unit.childrenCount} ${l10n.unitsCount.toLowerCase()}',
                              style: const TextStyle(
                                fontSize: 11,
                                fontWeight: FontWeight.w700,
                                color: CredoColors.ink,
                              ),
                            ),
                          ),
                      ],
                    ),
                  ],
                ),
              ),
              IconButton(
                tooltip: unit.name,
                icon: const Icon(Icons.info_outline_rounded, size: 20),
                color: CredoColors.mutedInk,
                onPressed: onOpenDetail,
              ),
              Icon(
                unit.childrenCount > 0
                    ? Icons.chevron_right_rounded
                    : Icons.arrow_outward_rounded,
                color: CredoColors.mutedInk,
              ),
            ],
          ),
        ),
      ),
    );
  }
}
