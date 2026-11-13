// The 文件 entry sits in two places, and which one is on screen depends on the
// window: the icon bar only exists while the workspace column is shut, so a wide
// window shows the sidebar's own row instead.
export async function openFiles(page) {
  const sidebar = page.locator('.studio-navlist [data-action="files.open"]');
  if (await sidebar.count()) {
    await sidebar.first().click();
    return "sidebar";
  }
  const bar = page.locator('.navbtn[aria-label="文件"]');
  if (await bar.count()) {
    await bar.first().click();
    return "bar";
  }
  throw new Error("no 文件 entry is on screen at this size");
}
