# Garage Organizer

A 2D top-down + 2.5D isometric garage layout planner. Built as a static site — runs entirely in the browser, no backend.

## Features

- **2D top view** with snap-to-grid, click-and-drag to move, corner-handle to resize
- **2.5D isometric view** to visualize stacks and tall items
- **Containers**: name, size, category (storage box, tools, equipment, workbench, shelves, temp, going-out, donation), color
- **Stacks**: a single container can hold multiple bins (top → bottom), each with its own contents list — and reorder
- **Auto-save** to localStorage on every edit
- **Export / Import / Sync**: download `garage.json`, commit it to your repo, and the other device can pull it back in

## Run locally

Just open `index.html` in a browser. Or to test the "Sync from repo" button (which fetches `garage.json`), serve the folder:

```powershell
# Python
python -m http.server 8000
# Or Node
npx http-server .
```

Then open `http://localhost:8000`.

## Deploy to GitHub Pages

1. Push this folder to a GitHub repo (e.g. `garage-organizer`).
2. In the repo: **Settings → Pages → Source: `main` branch, root**.
3. Visit `https://<your-username>.github.io/<repo-name>/`.

## How sync works

Both you and your wife load the same URL on your devices. The app auto-saves to **each device's** localStorage. To share the layout between devices:

- **Push your edits**: hit **Export** → downloads `garage.json` → commit and push to your repo.
- **Pull her edits**: after she pushes, hit **Sync** → re-fetches `garage.json` from the live site → overwrites local data.

For now the sync is manual but explicit — no merge conflicts, no surprises. (We can wire up GitHub API auto-commits later if you want it fully automatic.)

## Data model

```jsonc
{
  "version": 1,
  "garage": { "width": 30, "height": 20, "gridSize": 28 },
  "containers": [
    {
      "id": "uuid",
      "name": "Tool Chest",
      "category": "tools",
      "color": "#d44c4c",
      "x": 5, "y": 3,
      "w": 4, "h": 2,
      "height3d": 1,
      "notes": "",
      "contents": ["hammer", "wrench"],
      "stack": null
    },
    {
      "id": "uuid-2",
      "name": "Christmas Bins",
      "category": "storage-box",
      "x": 12, "y": 4,
      "w": 2, "h": 2,
      "stack": [
        { "name": "Lights",   "contents": ["white string", "icicle"] },
        { "name": "Ornaments", "contents": ["red box", "kids' crafts"] },
        { "name": "Tree",      "contents": ["7ft artificial"] }
      ]
    }
  ]
}
```

`stack[0]` is the top bin; the last element is on the floor.
