import 'package:flutter/material.dart';
import '../../../domain/models/ecclesiastical_unit.dart';
import '../../../l10n/generated/app_localizations.dart';
import '../labels.dart';
import '../theme.dart';

Future<EcclesiasticalUnit?> showUnitPickerDialog({
  required BuildContext context,
  required List<EcclesiasticalUnit> units,
  String? filterType,
  int? selectedUnitId,
  String? title,
}) {
  return showDialog<EcclesiasticalUnit>(
    context: context,
    builder: (ctx) => _UnitPickerDialog(
      units: units,
      filterType: filterType,
      selectedUnitId: selectedUnitId,
      title: title,
    ),
  );
}

class _UnitPickerDialog extends StatefulWidget {
  const _UnitPickerDialog({
    required this.units,
    this.filterType,
    this.selectedUnitId,
    this.title,
  });

  final List<EcclesiasticalUnit> units;
  final String? filterType;
  final int? selectedUnitId;
  final String? title;

  @override
  State<_UnitPickerDialog> createState() => _UnitPickerDialogState();
}

class _UnitPickerDialogState extends State<_UnitPickerDialog> {
  String _query = '';
  String? _typeFilter;

  @override
  void initState() {
    super.initState();
    _typeFilter = widget.filterType;
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final q = _query.trim().toLowerCase();

    final filtered = widget.units.where((u) {
      if (_typeFilter != null && _typeFilter!.isNotEmpty && u.unitType != _typeFilter) {
        return false;
      }
      if (q.isEmpty) return true;
      return u.name.toLowerCase().contains(q) ||
          u.countryName.toLowerCase().contains(q) ||
          u.city.toLowerCase().contains(q) ||
          u.officialLatinName.toLowerCase().contains(q);
    }).toList();

    return Dialog(
      backgroundColor: CredoColors.warmSurface,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 560, maxHeight: 620),
        child: Padding(
          padding: const EdgeInsets.all(20),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Row(
                children: [
                  const Icon(Icons.account_tree_rounded, color: CredoColors.cardinal),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Text(
                      widget.title ?? l10n.selectAffiliation,
                      style: Theme.of(context).textTheme.titleLarge,
                    ),
                  ),
                  IconButton(
                    onPressed: () => Navigator.of(context).pop(),
                    icon: const Icon(Icons.close_rounded),
                  ),
                ],
              ),
              const SizedBox(height: 12),
              TextField(
                autofocus: true,
                decoration: InputDecoration(
                  hintText: l10n.searchHierarchy,
                  prefixIcon: const Icon(Icons.search_rounded),
                ),
                onChanged: (v) => setState(() => _query = v),
              ),
              if (widget.filterType == null) ...[
                const SizedBox(height: 10),
                SingleChildScrollView(
                  scrollDirection: Axis.horizontal,
                  child: Row(
                    children: [
                      FilterChip(
                        label: Text(l10n.scopeGlobal),
                        selected: _typeFilter == null,
                        onSelected: (_) => setState(() => _typeFilter = null),
                      ),
                      const SizedBox(width: 6),
                      for (final t in const [
                        'holy_see',
                        'episcopal_conference',
                        'archdiocese',
                        'diocese',
                        'parish',
                        'religious_order',
                        'seminary',
                      ]) ...[
                        FilterChip(
                          label: Text(unitTypeLabel(l10n, t)),
                          selected: _typeFilter == t,
                          onSelected: (_) => setState(
                            () => _typeFilter = _typeFilter == t ? null : t,
                          ),
                        ),
                        const SizedBox(width: 6),
                      ],
                    ],
                  ),
                ),
              ],
              const SizedBox(height: 12),
              Expanded(
                child: filtered.isEmpty
                    ? Center(child: Text(l10n.noResults))
                    : ListView.separated(
                        itemCount: filtered.length,
                        separatorBuilder: (_, _) => const Divider(height: 1),
                        itemBuilder: (ctx, i) {
                          final u = filtered[i];
                          final selected = u.id == widget.selectedUnitId;
                          final accent = parseHexColor(u.accentColor);
                          return ListTile(
                            selected: selected,
                            selectedTileColor: CredoColors.vaticanGoldSoft,
                            leading: CircleAvatar(
                              backgroundColor: accent.withValues(alpha: 0.14),
                              child: Icon(
                                unitTypeIcon(u.unitType),
                                color: accent,
                                size: 20,
                              ),
                            ),
                            title: Text(
                              u.name,
                              style: const TextStyle(fontWeight: FontWeight.w600),
                            ),
                            subtitle: Text(
                              '${countryFlag(u.countryCode)} ${unitTypeLabel(l10n, u.unitType)}'
                              '${u.city.isNotEmpty ? ' · ${u.city}' : ''}'
                              '${u.countryName.isNotEmpty ? ', ${u.countryName}' : ''}',
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                            ),
                            trailing: selected
                                ? const Icon(Icons.check_circle_rounded,
                                    color: CredoColors.cardinal)
                                : const Icon(Icons.chevron_right_rounded),
                            onTap: () => Navigator.of(context).pop(u),
                          );
                        },
                      ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
