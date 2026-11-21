import 'package:flutter/material.dart';
import '../../../domain/models/credo_post.dart';
import '../../../domain/models/ecclesiastical_unit.dart';
import '../../../l10n/generated/app_localizations.dart';
import '../../../state/app_controller.dart';
import '../../core/labels.dart';
import '../../core/theme.dart';
import '../../core/widgets/unit_picker_dialog.dart';

Future<CredoPost?> showComposePostDialog({
  required BuildContext context,
  required AppController controller,
  EcclesiasticalUnit? initialScopeUnit,
}) {
  return showDialog<CredoPost>(
    context: context,
    builder: (ctx) => _ComposePostDialog(
      controller: controller,
      initialScopeUnit: initialScopeUnit,
    ),
  );
}

class _ComposePostDialog extends StatefulWidget {
  const _ComposePostDialog({
    required this.controller,
    this.initialScopeUnit,
  });

  final AppController controller;
  final EcclesiasticalUnit? initialScopeUnit;

  @override
  State<_ComposePostDialog> createState() => _ComposePostDialogState();
}

class _ComposePostDialogState extends State<_ComposePostDialog> {
  final _titleCtrl = TextEditingController();
  final _contentCtrl = TextEditingController();
  final _scriptureCtrl = TextEditingController();
  final _locationCtrl = TextEditingController();

  String _postType = 'homily';
  EcclesiasticalUnit? _scopeUnit;
  bool _submitting = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _scopeUnit = widget.initialScopeUnit ??
        widget.controller.currentUser?.primaryUnit ??
        (widget.controller.allUnits.isNotEmpty
            ? widget.controller.allUnits.first
            : null);
  }

  @override
  void dispose() {
    _titleCtrl.dispose();
    _contentCtrl.dispose();
    _scriptureCtrl.dispose();
    _locationCtrl.dispose();
    super.dispose();
  }

  Future<void> _publish() async {
    if (_contentCtrl.text.trim().isEmpty) return;
    setState(() {
      _submitting = true;
      _error = null;
    });
    try {
      final post = await widget.controller.api.createPost(
        content: _contentCtrl.text.trim(),
        title: _titleCtrl.text.trim(),
        postType: _postType,
        scopeUnitId: _scopeUnit?.id,
        scriptureRef: _scriptureCtrl.text.trim(),
        eventLocation: _locationCtrl.text.trim(),
        language: widget.controller.locale.languageCode,
      );
      if (mounted) Navigator.of(context).pop(post);
    } catch (e) {
      setState(() => _error = e.toString());
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);

    return Dialog(
      backgroundColor: CredoColors.warmSurface,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(22)),
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 600, maxHeight: 720),
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(24),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            mainAxisSize: MainAxisSize.min,
            children: [
              Row(
                children: [
                  const Icon(Icons.edit_note_rounded,
                      color: CredoColors.cardinal, size: 26),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Text(
                      l10n.newPublication,
                      style: Theme.of(context).textTheme.headlineSmall,
                    ),
                  ),
                  IconButton(
                    onPressed: () => Navigator.of(context).pop(),
                    icon: const Icon(Icons.close_rounded),
                  ),
                ],
              ),
              const SizedBox(height: 14),
              if (_error != null) ...[
                Container(
                  padding: const EdgeInsets.all(10),
                  decoration: BoxDecoration(
                    color: Colors.red.shade50,
                    borderRadius: BorderRadius.circular(10),
                  ),
                  child: Text(_error!,
                      style: TextStyle(color: Colors.red.shade800)),
                ),
                const SizedBox(height: 12),
              ],
              Text(
                l10n.postType,
                style: Theme.of(context)
                    .textTheme
                    .bodySmall
                    ?.copyWith(fontWeight: FontWeight.w700),
              ),
              const SizedBox(height: 8),
              Wrap(
                spacing: 8,
                runSpacing: 8,
                children: kPostTypes.map((t) {
                  final selected = _postType == t;
                  return ChoiceChip(
                    avatar: Icon(
                      postTypeIcon(t),
                      size: 16,
                      color: selected ? Colors.white : postTypeColor(t),
                    ),
                    label: Text(
                      postTypeLabel(l10n, t),
                      style: TextStyle(
                        color: selected ? Colors.white : CredoColors.ink,
                      ),
                    ),
                    selected: selected,
                    selectedColor: postTypeColor(t),
                    onSelected: (_) => setState(() => _postType = t),
                  );
                }).toList(),
              ),
              const SizedBox(height: 14),
              InkWell(
                onTap: () async {
                  final picked = await showUnitPickerDialog(
                    context: context,
                    units: widget.controller.allUnits,
                    selectedUnitId: _scopeUnit?.id,
                    title: l10n.targetScope,
                  );
                  if (picked != null) setState(() => _scopeUnit = picked);
                },
                borderRadius: BorderRadius.circular(12),
                child: InputDecorator(
                  decoration: InputDecoration(
                    labelText: l10n.targetScope,
                    prefixIcon: const Icon(Icons.account_tree_outlined),
                    suffixIcon: const Icon(Icons.arrow_drop_down_rounded),
                  ),
                  child: Text(
                    _scopeUnit != null
                        ? '${countryFlag(_scopeUnit!.countryCode)} ${_scopeUnit!.name}'
                        : l10n.scopeGlobal,
                  ),
                ),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: _titleCtrl,
                decoration: InputDecoration(labelText: l10n.postTitle),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: _contentCtrl,
                minLines: 4,
                maxLines: 8,
                decoration: InputDecoration(
                  hintText: l10n.postContent,
                  alignLabelWithHint: true,
                ),
              ),
              const SizedBox(height: 12),
              Row(
                children: [
                  Expanded(
                    child: TextField(
                      controller: _scriptureCtrl,
                      decoration: InputDecoration(
                        labelText: l10n.scriptureRef,
                        prefixIcon: const Icon(Icons.menu_book_outlined, size: 18),
                      ),
                    ),
                  ),
                  if (_postType == 'event' || _postType == 'announcement') ...[
                    const SizedBox(width: 10),
                    Expanded(
                      child: TextField(
                        controller: _locationCtrl,
                        decoration: InputDecoration(
                          labelText: l10n.eventLocation,
                          prefixIcon:
                              const Icon(Icons.place_outlined, size: 18),
                        ),
                      ),
                    ),
                  ],
                ],
              ),
              const SizedBox(height: 18),
              Row(
                mainAxisAlignment: MainAxisAlignment.end,
                children: [
                  OutlinedButton(
                    onPressed:
                        _submitting ? null : () => Navigator.of(context).pop(),
                    child: Text(l10n.cancel),
                  ),
                  const SizedBox(width: 10),
                  FilledButton.icon(
                    onPressed: _submitting ? null : _publish,
                    icon: _submitting
                        ? const SizedBox(
                            width: 16,
                            height: 16,
                            child: CircularProgressIndicator(
                                strokeWidth: 2, color: Colors.white),
                          )
                        : const Icon(Icons.send_rounded, size: 18),
                    label: Text(l10n.publish),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}
