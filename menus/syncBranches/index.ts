import { $ } from "bun";
import { chooseOption, handleUpdateOptionsMenu, initMenu } from "../../core/input/menu";
import { makeQuestion } from "../../core/input/question";
import { renderColor } from "../../core/input/text";
import { COLORS } from "../../core/terminal/colors";
import { showCursor } from "../../core/terminal/cursor";
import { ConfigService } from "../../services/configService";
import { showMenuStart } from "../start";

const branchExists = async (branch: string): Promise<boolean> => {
  try {
    await $`git rev-parse --verify ${branch}`.quiet();
    return true;
  } catch {
    return false;
  }
};

const syncSingleChild = async (parentBranch: string, childBranch: string, autoPush: boolean): Promise<boolean> => {
  process.stdout.write(renderColor(`\n🔀 Syncing "${childBranch}"...\n`, [COLORS.BOLD, COLORS.CYAN]));

  try {
    await $`git switch ${childBranch}`.quiet();
  } catch {
    process.stdout.write(renderColor(`⚠️  Failed to switch to "${childBranch}". Skipping.\n`, COLORS.RED));
    return false;
  }

  try {
    await $`git merge ${parentBranch}`.quiet();
  } catch {
    process.stdout.write(renderColor(`⚠️  Merge conflicts detected on "${childBranch}".\n`, COLORS.RED));
    process.stdout.write(
      renderColor(`   Please resolve them manually before syncing the remaining branches.\n`, COLORS.RED),
    );
    return false;
  }

  process.stdout.write(
    renderColor(`✅ "${childBranch}" updated with "${parentBranch}".\n`, [COLORS.BOLD, COLORS.GREEN]),
  );

  let shouldPush = autoPush;

  if (!autoPush) {
    const answer = await makeQuestion(renderColor(`Push "${childBranch}" to origin now? (y/n)`, COLORS.CYAN));
    shouldPush = answer.trim().toLowerCase() === "y";
  }

  if (shouldPush) {
    try {
      await $`git push origin ${childBranch}`.quiet();
      process.stdout.write(renderColor(`✅ Pushed "${childBranch}".\n`, [COLORS.BOLD, COLORS.GREEN]));
    } catch {
      process.stdout.write(renderColor(`⚠️  Failed to push "${childBranch}".\n`, COLORS.RED));
    }
  }

  return true;
};

const runSync = async (parentBranch: string, childBranches: string[], autoPush: boolean): Promise<void> => {
  for (const childBranch of childBranches) {
    const ok = await syncSingleChild(parentBranch, childBranch, autoPush);

    if (!ok) {
      process.stdout.write(
        renderColor(`\n🛑 Sync stopped on "${childBranch}". Remaining branches were not touched.\n`, [
          COLORS.BOLD,
          COLORS.YELLOW,
        ]),
      );
      showCursor();
      process.exit(0);
    }
  }

  try {
    await $`git switch ${parentBranch}`.quiet();
  } catch {}

  process.stdout.write(renderColor(`\n✅ All selected branches synced!\n`, [COLORS.BOLD, COLORS.GREEN]));
  process.stdout.write(renderColor(`👋 Goodbye!\n`, COLORS.CYAN));
  showCursor();
  process.exit(0);
};

const resolveChildren = async () => {
  const parentBranch = (await $`git rev-parse --abbrev-ref HEAD`.text()).trim();

  const configs = ConfigService.getConfig();

  const usesPrefix = configs.some((config) => parentBranch.startsWith(`${config.value}/`));

  if (usesPrefix) {
    process.stdout.write(renderColor(`⚠️  You are on a child branch ("${parentBranch}").\n`, COLORS.YELLOW));
    process.stdout.write(renderColor(`   Switch to the parent feature branch before syncing.\n`, COLORS.RED));
    showCursor();
    process.exit(0);
  }

  const children: { prefix: string; branch: string }[] = [];
  for (const config of configs) {
    const childBranch = `${config.value}/${parentBranch}`;
    if (await branchExists(childBranch)) {
      children.push({ prefix: config.value, branch: childBranch });
    }
  }

  return { parentBranch, children };
};

export const showSyncBranches = async () => {
  initMenu();

  process.stdout.write(renderColor("⏳ Looking for child branches...\n", COLORS.CYAN));

  const { parentBranch, children } = await resolveChildren();

  if (children.length === 0) {
    process.stdout.write(renderColor(`⚠️  No child branches found for "${parentBranch}".\n`, COLORS.YELLOW));
    setTimeout(() => showMenuStart(), 1500);
    return;
  }

  initMenu();

  const allBranches = children.map((c) => c.branch);

  const menuOptions = [
    {
      id: 1,
      label: `Sync all child branches (${children.length}) — ask before each push`,
      value: "all",
      action: () => runSync(parentBranch, allBranches, false),
    },
    {
      id: 2,
      label: `Sync all child branches (${children.length}) — auto push`,
      value: "all-push",
      action: () => runSync(parentBranch, allBranches, true),
    },
    ...children.map((child, idx) => ({
      id: idx + 3,
      label: `Sync only ${child.branch} — ask before push`,
      value: child.branch,
      action: () => runSync(parentBranch, [child.branch], false),
    })),
    {
      id: children.length + 3,
      label: "Go back",
      value: "back",
      isGoBack: true,
      action: () => {
        process.stdin.removeAllListeners("data");
        showMenuStart();
      },
    },
  ];

  const currentOption = 1;
  const title = renderColor(`Sync child branches of "${parentBranch}"`, [COLORS.BOLD, COLORS.CYAN]);

  chooseOption(currentOption, menuOptions, { title });
  process.stdin.on("data", handleUpdateOptionsMenu(currentOption, menuOptions, title));
};
