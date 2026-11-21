import 'package:flutter/material.dart';
import '../../../data/services/credo_api_service.dart';
import '../../../domain/models/credo_post.dart';
import '../../../domain/models/credo_user.dart';
import '../../../domain/models/ecclesiastical_unit.dart';
import '../../../l10n/generated/app_localizations.dart';
import '../../../state/app_controller.dart';
import '../../core/labels.dart';
import '../../core/theme.dart';
import '../../core/widgets/lineage_breadcrumbs.dart';
import '../../core/widgets/rank_badge.dart';
import '../../core/widgets/unit_picker_dialog.dart';
import '../../core/widgets/user_avatar.dart';
import '../auth/auth_sheet.dart';
import '../feed/post_card.dart';

class ProfileView extends StatefulWidget {
  const ProfileView({
    super.key,
    required this.userId,
    required this.controller,
    required this.onOpenUnit,
    required this.onOpenProfile,
    required this.onStartChatWithUser,
    this.embedded = false,
  });

  final int userId;
  final AppController controller;
  final void Function(int unitId) onOpenUnit;
  final void Function(int userId) onOpenProfile;
  final void Function(int userId) onStartChatWithUser;
  final bool embedded;

  @override
  State<ProfileView> createState() => _ProfileViewState();
}

class _ProfileViewState extends State<ProfileView> {
  ProfileDetailResponse? _detail;
  List<CredoPost> _posts = const [];
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void didUpdateWidget(covariant ProfileView oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.userId != widget.userId) {
      _load();
    }
  }

  Future<void> _load() async {
    setState(() => _loading = true);
    try {
      final results = await Future.wait([
        widget.controller.api.fetchUserProfile(widget.userId),
        widget.controller.api.fetchPosts(authorId: widget.userId),
      ]);
      if (mounted) {
        setState(() {
          _detail = results[0] as ProfileDetailResponse;
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

  Future<void> _editProfile() async {
    final l10n = AppLocalizations.of(context);
    final user = _detail!.user;
    final nameCtrl = TextEditingController(text: user.fullName);
    final prefixCtrl = TextEditingController(text: user.titlePrefix);
    final officeCtrl = TextEditingController(text: user.currentOfficeTitle);
    final bioCtrl = TextEditingController(text: user.bio);
    final mottoCtrl = TextEditingController(text: user.motto);
    EcclesiasticalUnit? pickedUnit = user.primaryUnit;
    EcclesiasticalUnit? pickedOrder = user.religiousOrder;

    final saved = await showDialog<bool>(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setModalState) => AlertDialog(
          title: Text(l10n.editProfile),
          content: SizedBox(
            width: 460,
            child: SingleChildScrollView(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  TextField(
                    controller: prefixCtrl,
                    decoration: InputDecoration(labelText: l10n.titlePrefix),
                  ),
                  const SizedBox(height: 10),
                  TextField(
                    controller: nameCtrl,
                    decoration: InputDecoration(labelText: l10n.fullName),
                  ),
                  const SizedBox(height: 10),
                  TextField(
                    controller: officeCtrl,
                    decoration:
                        InputDecoration(labelText: l10n.currentOfficeTitle),
                  ),
                  const SizedBox(height: 10),
                  InkWell(
                    onTap: () async {
                      final u = await showUnitPickerDialog(
                        context: ctx,
                        units: widget.controller.allUnits,
                        selectedUnitId: pickedUnit?.id,
                        title: l10n.primaryAffiliation,
                      );
                      if (u != null) setModalState(() => pickedUnit = u);
                    },
                    child: InputDecorator(
                      decoration: InputDecoration(
                        labelText: l10n.primaryAffiliation,
                        suffixIcon: const Icon(Icons.search_rounded),
                      ),
                      child: Text(pickedUnit?.name ?? '—'),
                    ),
                  ),
                  const SizedBox(height: 10),
                  InkWell(
                    onTap: () async {
                      final u = await showUnitPickerDialog(
                        context: ctx,
                        units: widget.controller.allUnits,
                        filterType: 'religious_order',
                        selectedUnitId: pickedOrder?.id,
                        title: l10n.religiousOrder,
                      );
                      if (u != null) setModalState(() => pickedOrder = u);
                    },
                    child: InputDecorator(
                      decoration: InputDecoration(
                        labelText: l10n.religiousOrder,
                        suffixIcon: const Icon(Icons.search_rounded),
                      ),
                      child: Text(pickedOrder?.name ?? '—'),
                    ),
                  ),
                  const SizedBox(height: 10),
                  TextField(
                    controller: mottoCtrl,
                    decoration: InputDecoration(labelText: l10n.motto),
                  ),
                  const SizedBox(height: 10),
                  TextField(
                    controller: bioCtrl,
                    maxLines: 3,
                    decoration: InputDecoration(labelText: l10n.bio),
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
                await widget.controller.api.updateMyProfile(
                  fullName: nameCtrl.text.trim(),
                  titlePrefix: prefixCtrl.text.trim(),
                  currentOfficeTitle: officeCtrl.text.trim(),
                  primaryUnitId: pickedUnit?.id,
                  religiousOrderId: pickedOrder?.id ?? 0,
                  motto: mottoCtrl.text.trim(),
                  bio: bioCtrl.text.trim(),
                );
                if (ctx.mounted) Navigator.of(ctx).pop(true);
              },
              child: Text(l10n.save),
            ),
          ],
        ),
      ),
    );

    if (saved == true) {
      await widget.controller.reloadCurrentUser();
      await _load();
    }
  }

  Future<void> _addAssignmentDialog() async {
    final l10n = AppLocalizations.of(context);
    final roleCtrl = TextEditingController();
    final startCtrl = TextEditingController();
    final endCtrl = TextEditingController();
    EcclesiasticalUnit? unit;
    bool isCurrent = true;
    bool isPrimary = false;

    final added = await showDialog<bool>(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setModalState) => AlertDialog(
          title: Text(l10n.addAssignment),
          content: SizedBox(
            width: 440,
            child: SingleChildScrollView(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  InkWell(
                    onTap: () async {
                      final u = await showUnitPickerDialog(
                        context: ctx,
                        units: widget.controller.allUnits,
                        title: l10n.selectAffiliation,
                      );
                      if (u != null) setModalState(() => unit = u);
                    },
                    child: InputDecorator(
                      decoration: InputDecoration(
                        labelText: l10n.selectAffiliation,
                        suffixIcon: const Icon(Icons.search_rounded),
                      ),
                      child: Text(unit?.name ?? '—'),
                    ),
                  ),
                  const SizedBox(height: 10),
                  TextField(
                    controller: roleCtrl,
                    decoration: InputDecoration(labelText: l10n.roleTitle),
                  ),
                  const SizedBox(height: 10),
                  Row(
                    children: [
                      Expanded(
                        child: TextField(
                          controller: startCtrl,
                          keyboardType: TextInputType.number,
                          decoration:
                              InputDecoration(labelText: l10n.startYear),
                        ),
                      ),
                      const SizedBox(width: 10),
                      Expanded(
                        child: TextField(
                          controller: endCtrl,
                          keyboardType: TextInputType.number,
                          decoration: InputDecoration(labelText: l10n.endYear),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 8),
                  SwitchListTile(
                    contentPadding: EdgeInsets.zero,
                    title: Text(l10n.currentAssignment),
                    value: isCurrent,
                    onChanged: (v) => setModalState(() => isCurrent = v),
                  ),
                  SwitchListTile(
                    contentPadding: EdgeInsets.zero,
                    title: Text(l10n.primaryAffiliation),
                    value: isPrimary,
                    onChanged: (v) => setModalState(() => isPrimary = v),
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
                if (unit == null || roleCtrl.text.trim().isEmpty) return;
                await widget.controller.api.addAssignment(
                  unitId: unit!.id,
                  roleTitle: roleCtrl.text.trim(),
                  startYear: int.tryParse(startCtrl.text.trim()),
                  endYear: int.tryParse(endCtrl.text.trim()),
                  isCurrent: isCurrent,
                  isPrimary: isPrimary,
                );
                if (ctx.mounted) Navigator.of(ctx).pop(true);
              },
              child: Text(l10n.save),
            ),
          ],
        ),
      ),
    );

    if (added == true) {
      await widget.controller.reloadCurrentUser();
      await _load();
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final content = _loading
        ? const Center(child: CircularProgressIndicator())
        : _detail == null
            ? Center(child: Text(l10n.noResults))
            : _buildContent(context, l10n);

    if (widget.embedded) return content;

    return Scaffold(
      appBar: AppBar(
        title: Text(_detail?.user.displayName ?? l10n.navProfile),
      ),
      body: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 880),
          child: content,
        ),
      ),
    );
  }

  Widget _buildContent(BuildContext context, AppLocalizations l10n) {
    final user = _detail!.user;
    final me = widget.controller.currentUser;
    final isOwn = me != null && me.id == user.id;
    final rankClr = rankColor(user.ecclesiasticalRank);
    final canVerifyOther = !isOwn &&
        me != null &&
        user.canPublish &&
        !user.isVerified &&
        (me.isAdmin ||
            (me.isVerified &&
                const ['pope', 'cardinal', 'archbishop', 'bishop']
                    .contains(me.ecclesiasticalRank)));

    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 88),
        children: [
          // Profile Hero Card
          Card(
            clipBehavior: Clip.antiAlias,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Container(
                  height: 92,
                  decoration: BoxDecoration(
                    gradient: LinearGradient(
                      colors: [rankClr, rankClr.withValues(alpha: 0.72)],
                      begin: Alignment.topLeft,
                      end: Alignment.bottomRight,
                    ),
                  ),
                ),
                Padding(
                  padding: const EdgeInsets.fromLTRB(20, 0, 20, 20),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Transform.translate(
                        offset: const Offset(0, -34),
                        child: Row(
                          crossAxisAlignment: CrossAxisAlignment.end,
                          children: [
                            Container(
                              padding: const EdgeInsets.all(3),
                              decoration: const BoxDecoration(
                                color: Colors.white,
                                shape: BoxShape.circle,
                              ),
                              child: UserAvatar(user: user, radius: 38),
                            ),
                            const Spacer(),
                            if (isOwn)
                              Wrap(
                                spacing: 8,
                                children: [
                                  OutlinedButton.icon(
                                    onPressed: _editProfile,
                                    icon: const Icon(Icons.edit_outlined,
                                        size: 16),
                                    label: Text(l10n.editProfile),
                                  ),
                                  IconButton(
                                    tooltip: l10n.signOut,
                                    onPressed: widget.controller.logout,
                                    icon: const Icon(Icons.logout_rounded),
                                  ),
                                ],
                              )
                            else
                              Wrap(
                                spacing: 8,
                                children: [
                                  FilledButton.icon(
                                    onPressed: () async {
                                      if (me == null) {
                                        await showAuthDialog(
                                          context: context,
                                          controller: widget.controller,
                                        );
                                        return;
                                      }
                                      await widget.controller.api
                                          .toggleFollowUser(
                                        user.id,
                                        follow: !user.isFollowing,
                                      );
                                      await _load();
                                    },
                                    icon: Icon(
                                      user.isFollowing
                                          ? Icons.check_rounded
                                          : Icons.person_add_outlined,
                                      size: 17,
                                    ),
                                    label: Text(user.isFollowing
                                        ? l10n.following
                                        : l10n.follow),
                                  ),
                                  OutlinedButton.icon(
                                    onPressed: () async {
                                      if (me == null) {
                                        await showAuthDialog(
                                          context: context,
                                          controller: widget.controller,
                                        );
                                        return;
                                      }
                                      widget.onStartChatWithUser(user.id);
                                    },
                                    icon: const Icon(Icons.mail_outline_rounded,
                                        size: 17),
                                    label: Text(l10n.sendMessage),
                                  ),
                                ],
                              ),
                          ],
                        ),
                      ),
                      Text(
                        user.displayName,
                        style: Theme.of(context).textTheme.headlineMedium,
                      ),
                      const SizedBox(height: 6),
                      Wrap(
                        spacing: 8,
                        runSpacing: 6,
                        crossAxisAlignment: WrapCrossAlignment.center,
                        children: [
                          RankBadge(
                            rank: user.ecclesiasticalRank,
                            isVerified: user.isVerified,
                          ),
                          if (user.canPublish &&
                              user.verificationStatus == 'pending')
                            Chip(
                              label: Text(l10n.pendingVerification),
                              avatar: const Icon(Icons.hourglass_top_rounded,
                                  size: 15),
                            ),
                          Text(
                            '@${user.username}',
                            style: Theme.of(context).textTheme.bodySmall,
                          ),
                          if (user.countryCode.isNotEmpty)
                            Text(
                              countryFlag(user.countryCode),
                              style: const TextStyle(fontSize: 16),
                            ),
                        ],
                      ),
                      if (user.currentOfficeTitle.isNotEmpty) ...[
                        const SizedBox(height: 8),
                        Text(
                          user.currentOfficeTitle,
                          style: Theme.of(context)
                              .textTheme
                              .titleMedium
                              ?.copyWith(color: CredoColors.cardinal),
                        ),
                      ],
                      if (user.motto.isNotEmpty) ...[
                        const SizedBox(height: 6),
                        Text(
                          '“${user.motto}”',
                          style: const TextStyle(
                            fontStyle: FontStyle.italic,
                            color: CredoColors.vaticanGold,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                      ],
                      if (user.bio.isNotEmpty) ...[
                        const SizedBox(height: 10),
                        Text(user.bio,
                            style: Theme.of(context).textTheme.bodyLarge),
                      ],

                      // Institutional Lineage ("A dónde pertenece")
                      if (user.lineage.isNotEmpty) ...[
                        const SizedBox(height: 16),
                        Container(
                          width: double.infinity,
                          padding: const EdgeInsets.all(14),
                          decoration: BoxDecoration(
                            color: CredoColors.parchment,
                            borderRadius: BorderRadius.circular(14),
                            border: Border.all(color: CredoColors.hairline),
                          ),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Row(
                                children: [
                                  const Icon(Icons.account_tree_rounded,
                                      size: 16, color: CredoColors.cardinal),
                                  const SizedBox(width: 6),
                                  Text(
                                    l10n.belongsToLineage,
                                    style: const TextStyle(
                                      fontWeight: FontWeight.w700,
                                      fontSize: 12.5,
                                      color: CredoColors.mutedInk,
                                    ),
                                  ),
                                ],
                              ),
                              const SizedBox(height: 8),
                              LineageBreadcrumbs(
                                lineage: user.lineage,
                                onTapUnit: widget.onOpenUnit,
                              ),
                              if (user.religiousOrder != null) ...[
                                const SizedBox(height: 10),
                                InkWell(
                                  onTap: () => widget
                                      .onOpenUnit(user.religiousOrder!.id),
                                  child: Row(
                                    mainAxisSize: MainAxisSize.min,
                                    children: [
                                      const Icon(Icons.auto_stories_rounded,
                                          size: 15,
                                          color: CredoColors.episcopalViolet),
                                      const SizedBox(width: 6),
                                      Text(
                                        '${l10n.religiousOrder}: ${user.religiousOrder!.name}',
                                        style: const TextStyle(
                                          fontWeight: FontWeight.w600,
                                          fontSize: 13,
                                          color: CredoColors.episcopalViolet,
                                        ),
                                      ),
                                    ],
                                  ),
                                ),
                              ],
                            ],
                          ),
                        ),
                      ],

                      if (canVerifyOther) ...[
                        const SizedBox(height: 12),
                        FilledButton.tonalIcon(
                          onPressed: () async {
                            await widget.controller.api.verifyUser(user.id);
                            await _load();
                          },
                          icon: const Icon(Icons.verified_rounded),
                          label: Text(l10n.verifyClergy),
                        ),
                      ],

                      const SizedBox(height: 16),
                      const Divider(),
                      const SizedBox(height: 12),
                      Row(
                        mainAxisAlignment: MainAxisAlignment.spaceAround,
                        children: [
                          _ProfileCounter(
                            value: '${user.followersCount}',
                            label: l10n.followers,
                          ),
                          _ProfileCounter(
                            value: '${user.followingCount}',
                            label: l10n.following,
                          ),
                          _ProfileCounter(
                            value: '${user.postsCount}',
                            label: l10n.posts,
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),

          // Assignment History Timeline
          const SizedBox(height: 20),
          Row(
            children: [
              Expanded(
                child: Text(
                  l10n.assignmentHistory,
                  style: Theme.of(context).textTheme.titleLarge,
                ),
              ),
              if (isOwn)
                TextButton.icon(
                  onPressed: _addAssignmentDialog,
                  icon: const Icon(Icons.add_rounded, size: 18),
                  label: Text(l10n.addAssignment),
                ),
            ],
          ),
          const SizedBox(height: 8),
          if (_detail!.assignments.isEmpty)
            Card(
              child: Padding(
                padding: const EdgeInsets.all(20),
                child: Text(l10n.noAssignmentsYet),
              ),
            )
          else
            Card(
              child: Column(
                children: [
                  for (int i = 0; i < _detail!.assignments.length; i++) ...[
                    if (i > 0) const Divider(height: 1),
                    _AssignmentRow(
                      assignment: _detail!.assignments[i],
                      canDelete: isOwn,
                      onTapUnit: () =>
                          widget.onOpenUnit(_detail!.assignments[i].unitId),
                      onDelete: () async {
                        await widget.controller.api
                            .deleteAssignment(_detail!.assignments[i].id);
                        await _load();
                      },
                    ),
                  ],
                ],
              ),
            ),

          // Publications by this user (only clergy can publish)
          if (user.canPublish || _posts.isNotEmpty) ...[
            const SizedBox(height: 22),
            Text(
              '${l10n.myPublications} (${_posts.length})',
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
        ],
      ),
    );
  }
}

class _ProfileCounter extends StatelessWidget {
  const _ProfileCounter({required this.value, required this.label});
  final String value;
  final String label;

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        Text(
          value,
          style: Theme.of(context).textTheme.titleLarge?.copyWith(
                color: CredoColors.cardinal,
              ),
        ),
        Text(label, style: Theme.of(context).textTheme.bodySmall),
      ],
    );
  }
}

class _AssignmentRow extends StatelessWidget {
  const _AssignmentRow({
    required this.assignment,
    required this.canDelete,
    required this.onTapUnit,
    required this.onDelete,
  });

  final UserAssignment assignment;
  final bool canDelete;
  final VoidCallback onTapUnit;
  final VoidCallback onDelete;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final accent = parseHexColor(assignment.accentColor);
    final years = [
      if (assignment.startYear != null) '${assignment.startYear}',
      if (assignment.endYear != null)
        '${assignment.endYear}'
      else if (assignment.isCurrent)
        l10n.present,
    ].join(' — ');

    return ListTile(
      onTap: onTapUnit,
      leading: CircleAvatar(
        backgroundColor: accent.withValues(alpha: 0.14),
        child: Icon(unitTypeIcon(assignment.unitType), color: accent, size: 19),
      ),
      title: Text(
        assignment.roleTitle,
        style: const TextStyle(fontWeight: FontWeight.w700),
      ),
      subtitle: Text(
        '${countryFlag(assignment.countryCode)} ${assignment.unitName}'
        '${years.isNotEmpty ? ' · $years' : ''}',
      ),
      trailing: canDelete
          ? IconButton(
              icon: const Icon(Icons.delete_outline_rounded, size: 18),
              onPressed: onDelete,
            )
          : const Icon(Icons.chevron_right_rounded),
    );
  }
}
