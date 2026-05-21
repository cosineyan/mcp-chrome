# rgm-ppt-addin

Office.js Task Pane add-in for PowerPoint. Works on desktop (Mac/Windows) and SharePoint Online.

## Load the add-in

### Desktop PowerPoint (Mac)

1. Start the server: `python ../rgm-ppt-cli/server.py`
2. In PowerPoint: **Insert → Add-ins → My Add-ins → Upload My Add-in** → select `manifest.xml`

### SharePoint Online

Same as above, but the add-in task pane will try to connect to `http://localhost:12308` — this requires a tunnel:

```bash
# Expose local server via SSH tunnel (replace relay.example.com with your host)
ssh -R 12308:localhost:12308 relay.example.com
```

Then in the task pane, change the Server URL field to `https://relay.example.com:12308`.

## Files

| File            | Purpose                                             |
| --------------- | --------------------------------------------------- |
| `manifest.xml`  | Add-in registration (host, permissions, source URL) |
| `taskpane.html` | Task pane shell                                     |
| `taskpane.js`   | Polls `/next`, executes Office.js commands          |
| `taskpane.css`  | Styles                                              |

## Supported commands

| action         | Parameters                                             |
| -------------- | ------------------------------------------------------ |
| `add_slide`    | `layout?`, `after?`                                    |
| `delete_slide` | `slideIndex`                                           |
| `set_title`    | `slideIndex`, `text`                                   |
| `set_text`     | `slideIndex`, `shapeName`, `text`                      |
| `add_textbox`  | `slideIndex`, `text`, `left`, `top`, `width`, `height` |
