// tools/multiproject.mjs — multi-project (.uvmpw) authoring, matching project_mpw.xsd.
import fs from 'node:fs';
import path from 'node:path';
import { register, str, arr, bool } from './common.mjs';
import { readMultiProject, multiProjectTargets, Project } from '../project.mjs';

const HEADER = `<?xml version="1.0" encoding="UTF-8" standalone="no" ?>
<ProjectWorkspace xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="project_mpw.xsd">

  <SchemaVersion>1.0</SchemaVersion>

  <Header>### uVision Project, (C) Keil Software</Header>

  <WorkspaceName>__NAME__</WorkspaceName>
`;

export function writeMultiProject(file, name, projects) {
  let x = HEADER.replace('__NAME__', escapeXml(name));
  for (const p of projects) {
    x += `\n  <project>\n    <PathAndName>${escapeXml(p.path)}</PathAndName>\n`;
    if (p.active) x += `    <NodeIsActive>1</NodeIsActive>\n`;
    if (p.expanded !== false) x += `    <NodeIsExpanded>1</NodeIsExpanded>\n`;
    x += `  </project>\n`;
  }
  x += '\n</ProjectWorkspace>\n';
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, x, 'utf8');
  return file;
}

function escapeXml(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

/**
 * Batch-Build selection is NOT a workspace flag: UV4 -b honours
 * <TargetCommonOption><SelectedForBatchBuild> inside each member project
 * (verified: flag 0 -> "2 skipped", flag 1 -> project built).
 */
function setBatchFlags(projectFile, enable) {
  const pr = new Project(projectFile);
  let changed = 0;
  for (const t of pr.targets()) {
    if (t.batchBuild !== enable) { pr.setTargetValue(t.name, ['TargetOption', 'TargetCommonOption', 'SelectedForBatchBuild'], enable ? 1 : 0); changed++; }
  }
  if (changed) pr.save();
  return changed;
}

export function registerMultiProjectTools(ctx) {
  register(ctx, {
    name: 'project_create_multi',
    description: 'Create a µVision multi-project workspace (.uvmpw, project_mpw.xsd) and set the per-target Batch-Build flags inside each member project so UV4 -b actually builds them. Verified against UV4 batch output.',
    inputSchema: {
      type: 'object',
      properties: {
        output: str('Output .uvmpw path'),
        name: str('Workspace name (default file name)'),
        projects: arr({ type: 'object' }, 'Members: [{path, batchBuild?, active?}] (path relative to the .uvmpw)'),
        setBatchFlags: bool('Write SelectedForBatchBuild=1 into member projects (default true)'),
      },
      required: ['output', 'projects'],
    },
    handler: async (args) => {
      const out = path.resolve(args.output);
      const dir = path.dirname(out);
      const members = (args.projects || []).map((p, i) => ({ path: p.path, active: !!p.active || i === 0, expanded: p.expanded !== false }));
      const flags = [];
      for (const m of members) {
        const abs = path.resolve(dir, m.path);
        if (!fs.existsSync(abs)) return { ok: false, error: `member project missing: ${abs}` };
        if (args.setBatchFlags !== false) flags.push({ project: abs, targetsUpdated: setBatchFlags(abs, true) });
      }
      writeMultiProject(out, args.name || path.basename(out, path.extname(out)), members);
      const parsed = readMultiProject(out);
      return { ok: true, file: out, workspaceName: parsed.workspaceName, projects: parsed.projects, batchFlags: flags, hint: 'Run uv4_rebuild_all (mode=all) or uv4_run command=-b on this workspace.' };
    },
  });

  register(ctx, {
    name: 'project_multi_add',
    description: 'Add or update a member project in an existing .uvmpw workspace, optionally enabling its Batch-Build flag.',
    inputSchema: {
      type: 'object',
      properties: { multi: str('Existing .uvmpw'), path: str('Member project path'), batchBuild: bool('Set SelectedForBatchBuild=1 in the member (default true)'), active: bool('Make active') },
      required: ['multi', 'path'],
    },
    handler: async (args) => {
      const mp = readMultiProject(args.multi);
      const dir = path.dirname(mp.file);
      const abs = path.resolve(dir, args.path);
      if (!fs.existsSync(abs)) return { ok: false, error: `member project missing: ${abs}` };
      const list = mp.projects.filter(p => path.resolve(dir, p.path).toLowerCase() !== abs.toLowerCase());
      list.push({ path: args.path, active: !!args.active, expanded: true });
      if (args.batchBuild !== false) setBatchFlags(abs, true);
      writeMultiProject(mp.file, mp.workspaceName || path.basename(mp.file, path.extname(mp.file)), list);
      return { ok: true, file: mp.file, projects: readMultiProject(mp.file).projects };
    },
  });

  register(ctx, {
    name: 'project_multi_read',
    description: 'Read a workspace and expand every member project into its targets, project-level batch flag and output folders.',
    inputSchema: { type: 'object', properties: { multi: str('.uvmpw path') }, required: ['multi'] },
    handler: async (args) => {
      const mp = readMultiProject(path.resolve(args.multi));
      return { ok: true, workspaceName: mp.workspaceName, projects: mp.projects, ...multiProjectTargets(mp.file) };
    },
  });

  register(ctx, {
    name: 'project_batch_flags',
    description: 'Read or set <SelectedForBatchBuild> for every target of one or more projects (the flag UV4 -b/-z/-q honour).',
    inputSchema: {
      type: 'object',
      properties: { projects: arr({ type: 'string' }, 'Project files'), set: bool('Write the flag instead of reading it'), enabled: bool('Value to write') },
      required: ['projects'],
    },
    handler: async (args) => {
      const out = [];
      for (const p of args.projects) {
        const pr = new Project(path.resolve(p));
        if (args.set) {
          let changed = 0;
          for (const t of pr.targets()) if (t.batchBuild !== !!args.enabled) { pr.setTargetValue(t.name, ['TargetOption', 'TargetCommonOption', 'SelectedForBatchBuild'], args.enabled ? 1 : 0); changed++; }
          if (changed) pr.save();
          out.push({ project: pr.file, changed });
        } else {
          out.push({ project: pr.file, targets: pr.targets().map(t => ({ name: t.name, batchBuild: t.batchBuild })) });
        }
      }
      return { ok: true, projects: out };
    },
  });
}
