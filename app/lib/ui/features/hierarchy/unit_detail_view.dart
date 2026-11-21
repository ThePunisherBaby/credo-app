import 'package:flutter/material.dart';
import '../../../data/services/credo_api_service.dart';
import '../../../domain/models/credo_post.dart';
import '../../../domain/models/ecclesiastical_unit.dart';
import '../../../l10n/generated/app_localizations.dart';
import '../../../state/app_controller.dart';
import '../../core/labels.dart';
import '../../core/theme.dart';
import '../../core/widgets/lineage_breadcrumbs.dart';
import '../../core/widgets/rank_badge.dart';
import '../../core/widgets/user_avatar.dart';
import '../auth/auth_sheet.dart';
import '../feed/compose_post_dialog.dart';
import '../feed/post_card.dart';

class UnitDetailView extends StatefulWidget {
  const UnitDetailView({
    super.key,
    required this.unitId,
    required this.controller,
    required this.onOpenUnit,
    required this.onOpenProfile,
    required this.onOpenPastoralGroup,
  });

  final int unitId;
  final AppController controller;
  final void Function(int unitId) onOpenUnit;
  final void Function(int userId) onOpenProfile;
  final void Function(int conversationId) onOpenPastoralGroup;

  @override
  State<UnitDetailView> createState() => _UnitDetailViewState();
}

class _UnitDetailViewState extends State<UnitDetailView> {
  UnitDetailResponse? _detail;
  List<CredoPost> _posts = const [];
  bool _loading = true;
  bool _togglingFollow = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void didUpdateWidget(covariant UnitDetailView oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.unitId != widget.unitId) {
      _load();
    }
  }

  Future<void> _load() async {
    setState(() => _loading = true);
    try {
      final results = await Future.wait([
        widget.controller.api.fetchUnitDetail(widget.unitId),
        widget.controller.api.fetchPosts(scope: 'unit', unitId: widget.unitId),
      ]);
      if (mounted) {
        setState(() {
          _detail = results[0] as UnitDetailResponse;
          _posts =
              (results[1] as ({List<CredoPost> posts, EcclesiasticalUnit? resolvedScope}))
                  .posts;
          _loading = false;
        });
      }
    } catch (_) {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _toggleFollow() async {
    if (!widget.controller.isAuthenticated) {
      await showAuthDialog(context: context, controller: widget.controller);
      return;
    }
    if (_detail == null || _togglingFollow) return;
    setState(() => _togglingFollow = true);
    try {
      await widget.controller.api.toggleFollowUnit(
        widget.unitId,
        follow: !_detail!.unit.isFollowing,
      );
      await _load();
    } finally {
      if (mounted) setState(() => _togglingFollow = false);
    }
  }

  Future<void> _showCreateSubUnitDialog() async {
    final l10n = AppLocalizations.of(context);
    final nameCtrl = TextEditingController();
    final latinCtrl = TextEditingController();
    final cityCtrl = TextEditingController();
    final patronCtrl = TextEditingController();
    final descCtrl = TextEditingController();
    final parentType = _detail!.unit.unitType;

    String defaultChildType = 'parish';
    if (parentType == 'holy_see') {
      defaultChildType = 'episcopal_conference';
    } else if (parentType == 'episcopal_conference') {
      defaultChildType = 'archdiocese';
    } else if (parentType == 'archdiocese') {
      defaultChildType = 'diocese';
    }
    String selectedType = defaultChildType;

    final created = await showDialog<bool>(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setModalState) => AlertDialog(
          title: Text(l10n.addEcclesiasticalUnit),
          content: SizedBox(
            width: 440,
            child: SingleChildScrollView(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  DropdownButtonFormField<String>(
                    initialValue: selectedType,
                    decoration: InputDecoration(labelText: l10n.unitType),
                    items: kUnitTypes
                        .where((t) => t != 'holy_see')
                        .map((t) => DropdownMenuItem(
                              value: t,
                              child: Text(unitTypeLabel(l10n, t)),
                            ))
                        .toList(),
                    onChanged: (v) {
                      if (v != null) setModalState(() => selectedType = v);
                    },
                  ),
                  const SizedBox(height: 10),
                  TextField(
                    controller: nameCtrl,
                    decoration: InputDecoration(labelText: l10n.unitName),
                  ),
                  const SizedBox(height: 10),
                  TextField(
                    controller: latinCtrl,
                    decoration: InputDecoration(labelText: l10n.latinName),
                  ),
                  const SizedBox(height: 10),
                  TextField(
                    controller: cityCtrl,
                    decoration: InputDecoration(labelText: l10n.city),
                  ),
                  const SizedBox(height: 10),
                  TextField(
                    controller: patronCtrl,
                    decoration: InputDecoration(labelText: l10n.patronSaint),
                  ),
                  const SizedBox(height: 10),
                  TextField(
                    controller: descCtrl,
                    maxLines: 3,
                    decoration: InputDecoration(labelText: l10n.description),
                  ),
                ],
              ),
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(ctx).pop(false),
              child: Text(l10n.cancel),
            ),
            FilledButton(
              onPressed: () async {
                if (nameCtrl.text.trim().isEmpty) return;
                await widget.controller.api.createUnit(
                  name: nameCtrl.text.trim(),
                  unitType: selectedType,
                  parentId: widget.unitId,
                  officialLatinName: latinCtrl.text.trim(),
                  city: cityCtrl.text.trim(),
                  patronSaint: patronCtrl.text.trim(),
                  description: descCtrl.text.trim(),
                );
                if (ctx.mounted) Navigator.of(ctx).pop(true);
              },
              child: Text(l10n.save),
            ),
          ],
        ),
      ),
    );

    if (created == true) {
      await widget.controller.refreshGlobalData();
      await _load();
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);

    return Scaffold(
      appBar: AppBar(
        title: Text(_detail?.unit.name ?? l10n.navHierarchy),
        actions: [
          if (widget.controller.canPublish && _detail != null)
            IconButton(
              tooltip: l10n.newPublication,
              icon: const Icon(Icons.edit_note_rounded),
              onPressed: () async {
                final created = await showComposePostDialog(
                  context: context,
                  controller: widget.controller,
                  initialScopeUnit: _detail!.unit,
                );
                if (created != null) await _load();
              },
            ),
        ],
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _detail == null
              ? Center(child: Text(l10n.noResults))
              : _buildBody(context, l10n),
    );
  }

  Widget _buildBody(BuildContext context, AppLocalizations l10n) {
    final unit = _detail!.unit;
    final accent = parseHexColor(unit.accentColor);

    return Center(
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 880),
        child: RefreshIndicator(
          onRefresh: _load,
          child: ListView(
            padding: const EdgeInsets.all(16),
            children: [
              // Institution Hero Banner
              Card(
                clipBehavior: Clip.antiAlias,
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Container(
                      width: double.infinity,
                      padding: const EdgeInsets.all(22),
                      decoration: BoxDecoration(
                        gradient: LinearGradient(
                          colors: [accent, accent.withValues(alpha: 0.78)],
                          begin: Alignment.topLeft,
                          end: Alignment.bottomRight,
                        ),
                      ),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Wrap(
                            spacing: 8,
                            runSpacing: 6,
                            crossAxisAlignment: WrapCrossAlignment.center,
                            children: [
                              Container(
                                padding: const EdgeInsets.symmetric(
                                    horizontal: 10, vertical: 4),
                                decoration: BoxDecoration(
                                  color: Colors.white.withValues(alpha: 0.18),
                                  borderRadius: BorderRadius.circular(999),
                                ),
                                child: Row(
                                  mainAxisSize: MainAxisSize.min,
                                  children: [
                                    Icon(unitTypeIcon(unit.unitType),
                                        size: 14, color: Colors.white),
                                    const SizedBox(width: 5),
                                    Text(
                                      unitTypeLabel(l10n, unit.unitType),
                                      style: const TextStyle(
                                        color: Colors.white,
                                        fontWeight: FontWeight.w700,
                                        fontSize: 12,
                                      ),
                                    ),
                                  ],
                                ),
                              ),
                              if (unit.countryCode.isNotEmpty)
                                Container(
                                  padding: const EdgeInsets.symmetric(
                                      horizontal: 10, vertical: 4),
                                  decoration: BoxDecoration(
                                    color: Colors.white.withValues(alpha: 0.14),
                                    borderRadius: BorderRadius.circular(999),
                                  ),
                                  child: Text(
                                    '${countryFlag(unit.countryCode)} ${unit.city.isNotEmpty ? '${unit.city}, ' : ''}${unit.countryName}',
                                    style: const TextStyle(
                                      color: Colors.white,
                                      fontSize: 12,
                                      fontWeight: FontWeight.w600,
                                    ),
                                  ),
                                ),
                            ],
                          ),
                          const SizedBox(height: 12),
                          Text(
                            unit.name,
                            style: Theme.of(context)
                                .textTheme
                                .headlineMedium
                                ?.copyWith(color: Colors.white),
                          ),
                          if (unit.officialLatinName.isNotEmpty) ...[
                            const SizedBox(height: 4),
                            Text(
                              unit.officialLatinName,
                              style: TextStyle(
                                color: Colors.white.withValues(alpha: 0.85),
                                fontStyle: FontStyle.italic,
                                fontSize: 14,
                              ),
                            ),
                          ],
                          if (unit.motto.isNotEmpty) ...[
                            const SizedBox(height: 8),
                            Text(
                              '“${unit.motto}”',
                              style: const TextStyle(
                                color: CredoColors.vaticanGoldSoft,
                                fontWeight: FontWeight.w600,
                                fontStyle: FontStyle.italic,
                              ),
                            ),
                          ],
                        ],
                      ),
                    ),
                    Padding(
                      padding: const EdgeInsets.all(18),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          if (unit.lineage.isNotEmpty) ...[
                            Text(
                              l10n.belongsToLineage,
                              style: Theme.of(context)
                                  .textTheme
                                  .bodySmall
                                  ?.copyWith(fontWeight: FontWeight.w700),
                            ),
                            const SizedBox(height: 6),
                            LineageBreadcrumbs(
                              lineage: unit.lineage,
                              onTapUnit: (id) {
                                if (id != widget.unitId) widget.onOpenUnit(id);
                              },
                            ),
                            const SizedBox(height: 14),
                          ],
                          if (unit.description.isNotEmpty) ...[
                            Text(unit.description,
                                style: Theme.of(context).textTheme.bodyLarge),
                            const SizedBox(height: 12),
                          ],
                          Wrap(
                            spacing: 14,
                            runSpacing: 6,
                            children: [
                              if (unit.patronSaint.isNotEmpty)
                                _InfoPill(
                                  icon: Icons.auto_awesome_rounded,
                                  text:
                                      '${l10n.patronSaint}: ${unit.patronSaint}',
                                ),
                              if (unit.foundedYear != null)
                                _InfoPill(
                                  icon: Icons.history_edu_rounded,
                                  text:
                                      '${l10n.foundedYear}: ${unit.foundedYear}',
                                ),
                              _InfoPill(
                                icon: Icons.people_outline_rounded,
                                text:
                                    '${unit.followersCount} ${l10n.followers}',
                              ),
                            ],
                          ),
                          const SizedBox(height: 16),
                          Wrap(
                            spacing: 10,
                            runSpacing: 8,
                            children: [
                              FilledButton.icon(
                                onPressed: _toggleFollow,
                                icon: Icon(
                                  unit.isFollowing
                                      ? Icons.check_rounded
                                      : Icons.add_rounded,
                                  size: 18,
                                ),
                                label: Text(unit.isFollowing
                                    ? l10n.following
                                    : l10n.follow),
                              ),
                              if (unit.pastoralGroupId != null)
                                OutlinedButton.icon(
                                  onPressed: () async {
                                    if (!widget.controller.isAuthenticated) {
                                      await showAuthDialog(
                                        context: context,
                                        controller: widget.controller,
                                      );
                                      return;
                                    }
                                    widget.onOpenPastoralGroup(
                                      unit.pastoralGroupId!,
                                    );
                                  },
                                  icon: const Icon(Icons.forum_outlined,
                                      size: 18),
                                  label: Text(l10n.openPastoralGroup),
                                ),
                              if (widget.controller.canPublish)
                                OutlinedButton.icon(
                                  onPressed: _showCreateSubUnitDialog,
                                  icon: const Icon(Icons.add_business_outlined,
                                      size: 18),
                                  label: Text(l10n.addEcclesiasticalUnit),
                                ),
                            ],
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
              ),

              // Subordinate Units
              if (_detail!.children.isNotEmpty) ...[
                const SizedBox(height: 22),
                Text(
                  '${l10n.subordinateUnits} (${_detail!.children.length})',
                  style: Theme.of(context).textTheme.titleLarge,
                ),
                const SizedBox(height: 10),
                for (final child in _detail!.children) ...[
                  Card(
                    child: ListTile(
                      leading: CircleAvatar(
                        backgroundColor: parseHexColor(child.accentColor)
                            .withValues(alpha: 0.14),
                        child: Icon(
                          unitTypeIcon(child.unitType),
                          color: parseHexColor(child.accentColor),
                          size: 20,
                        ),
                      ),
                      title: Text(
                        child.name,
                        style: const TextStyle(fontWeight: FontWeight.w700),
                      ),
                      subtitle: Text(
                        '${countryFlag(child.countryCode)} ${unitTypeLabel(l10n, child.unitType)}'
                        '${child.city.isNotEmpty ? ' · ${child.city}' : ''}'
                        '${child.childrenCount > 0 ? ' · ${child.childrenCount} sub' : ''}',
                      ),
                      trailing: const Icon(Icons.chevron_right_rounded),
                      onTap: () => widget.onOpenUnit(child.id),
                    ),
                  ),
                  const SizedBox(height: 8),
                ],
              ],

              // Affiliated Clergy & Faithful
              if (_detail!.members.isNotEmpty) ...[
                const SizedBox(height: 22),
                Text(
                  '${l10n.affiliatedMembers} (${_detail!.members.length})',
                  style: Theme.of(context).textTheme.titleLarge,
                ),
                const SizedBox(height: 10),
                for (final member in _detail!.members) ...[
                  Card(
                    child: ListTile(
                      leading: UserAvatar(user: member, radius: 22),
                      title: Wrap(
                        spacing: 8,
                        crossAxisAlignment: WrapCrossAlignment.center,
                        children: [
                          Text(
                            member.displayName,
                            style: const TextStyle(fontWeight: FontWeight.w700),
                          ),
                          RankBadge(
                            rank: member.ecclesiasticalRank,
                            isVerified: member.isVerified,
                            compact: true,
                          ),
                        ],
                      ),
                      subtitle: Text(
                        [
                          if (member.currentOfficeTitle.isNotEmpty)
                            member.currentOfficeTitle,
                          if (member.primaryUnit != null)
                            member.primaryUnit!.name,
                        ].join(' · '),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                      trailing: const Icon(Icons.chevron_right_rounded),
                      onTap: () => widget.onOpenProfile(member.id),
                    ),
                  ),
                  const SizedBox(height: 8),
                ],
              ],

              // Scoped Publications
              const SizedBox(height: 22),
              Text(
                '${l10n.posts} (${_posts.length})',
                style: Theme.of(context).textTheme.titleLarge,
              ),
              const SizedBox(height: 10),
              if (_posts.isEmpty)
                Card(
                  child: Padding(
                    padding: const EdgeInsets.all(24),
                    child: Center(child: Text(l10n.noPostsYet)),
                  ),
                )
              else
                for (final post in _posts) ...[
                  PostCard(
                    post: post,
                    controller: widget.controller,
                    onTapAuthor: widget.onOpenProfile,
                    onTapUnit: widget.onOpenUnit,
                    onReact: (type) async {
                      if (!widget.controller.isAuthenticated) {
                        await showAuthDialog(
                          context: context,
                          controller: widget.controller,
                        );
                        return;
                      }
                      await widget.controller.api.toggleReaction(post.id, type);
                      await _load();
                    },
                    onOpenComments: () => showCommentsSheet(
                      context: context,
                      controller: widget.controller,
                      post: post,
                      onTapAuthor: widget.onOpenProfile,
                      onCommentAdded: _load,
                      onRequireAuth: () => showAuthDialog(
                        context: context,
                        controller: widget.controller,
                      ),
                    ),
                  ),
                  const SizedBox(height: 12),
                ],
            ],
          ),
        ),
      ),
    );
  }
}

class _InfoPill extends StatelessWidget {
  const _InfoPill({required this.icon, required this.text});
  final IconData icon;
  final String text;

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(icon, size: 15, color: CredoColors.mutedInk),
        const SizedBox(width: 5),
        Text(text, style: Theme.of(context).textTheme.bodySmall),
      ],
    );
  }
}
