# Home Assistant Editor

A robust visual editor for Home Assistant automations and scripts. This addon provides a cleaner, more intuitive interface for creating and editing automations compared to Home Assistant's built-in editor.

![Screenshot 1](https://github.com/saihgupr/HomeAssistantEditor/raw/main/images/screenshot-1.png)
![Screenshot 2](https://github.com/saihgupr/HomeAssistantEditor/raw/main/images/screenshot-2.png)
![Screenshot 3](https://github.com/saihgupr/HomeAssistantEditor/raw/main/images/screenshot-4.png)
![Screenshot 4](https://github.com/saihgupr/HomeAssistantEditor/raw/main/images/screenshot-3.png)

## Features

- **Three-Column Layout** - Sidebar navigation, items list, and editor workspace side by side
- **Visual Action Blocks** - Color-coded, expandable blocks for triggers, conditions, and actions
- **Advanced Editing** - Inline editing with searchable pickers and instant Visual/YAML toggles
- **Smart Folders & Hashtags** - Organize and filter your items using custom folders and tags
- **Version History & Restore** - Browse "commits" and restore previous versions via Version Control integration
- **Trace Replay Mode** - Navigate past runs step-by-step to debug logic or condition failures
- **Professional YAML Support** - Handles `!include` patterns and orphan entity cleanup automatically
- **Instant Sync** - Changes are saved directly to your YAML and auto-reloaded in Home Assistant

## Installation

There are two ways to install Home Assistant Editor: as a Home Assistant add-on or as a standalone Docker container.

### 1. Home Assistant Add-on (Recommended for most users)

1.  **Add Repository:**
    Click the button below to add the repository to your Home Assistant instance:

    [![Open your Home Assistant instance and show the add-on store](https://my.home-assistant.io/badges/supervisor_add_addon_repository.svg)](https://my.home-assistant.io/redirect/supervisor_add_addon_repository/?repository_url=https://github.com/saihgupr/ha-addons)

    **Or manually add it:**
    - Navigate to **Settings** → **Add-ons** → **Add-on Store**
    - Click the three dots (⋮) in the top right corner and select **Repositories**
    - Add the repository URL: `https://github.com/saihgupr/ha-addons`

2.  **Install the Add-on:**
    Search for "Home Assistant Editor" in the store and click **Install**.

3.  **Start:** Start the add-on and click **Open Web UI**.

### 2. Standalone Docker Installation

For Docker users who aren't using the Home Assistant add-on, you have three deployment options:

**Option A: Docker Compose (recommended):**

1. Download the `compose.yaml` file:
   ```bash
   curl -o compose.yaml https://github.com/saihgupr/HomeAssistantEditor/raw/main/compose.yaml
   ```

2. Edit the file to set your paths:
   ```bash
   nano compose.yaml
   # Update the volume path: /path/to/your/ha/config
   ```

3. Start the service:
   ```bash
   docker compose up -d
   ```

**Option B: Docker Run (pre-built image):**

```bash
docker run -d \
  --name ha-editor \
  -v /path/to/your/ha/config:/config \
  -e HA_URL="http://your-home-assistant-ip:8123" \
  -e SUPERVISOR_TOKEN="your_long_lived_access_token" \
  -p 54002:54002 \
  ghcr.io/saihgupr/homeassistant-editor:latest
```

**Option C: Build locally:**

```bash
git clone https://github.com/saihgupr/HomeAssistantEditor.git
cd HomeAssistantEditor/homeassistant-editor
docker build -t ha-editor .

docker run -d \
  --name ha-editor \
  -v /path/to/your/ha/config:/config \
  -e HA_URL="http://your-home-assistant-ip:8123" \
  -e SUPERVISOR_TOKEN="your_long_lived_access_token" \
  -p 54002:54002 \
  ha-editor
```

### Local Development

```bash
# Clone the repository
git clone https://github.com/saihgupr/HomeAssistantEditor.git
cd HomeAssistantEditor/homeassistant-editor

# Install dependencies
npm install

# Start the server (uses ./test-config as the config path)
CONFIG_PATH=./test-config npm run dev
```

## Configuration

### Environment Variables

When running in Docker mode, the application can be configured using the following environment variables:

| Variable | Description | Default |
| :--- | :--- | :--- |
| `HA_URL` | The external URL of your Home Assistant instance | `null` |
| `SUPERVISOR_TOKEN` | A Long Lived Access Token created in your HA profile | `null` |
| `CONFIG_PATH` | The internal path to the HA config directory | `/config` |
| `PORT` | The port the server listens on | `54002` |

> [!NOTE]
> For standalone usage, `SUPERVISOR_TOKEN` and `HA_URL` are required for the editor to communicate with Home Assistant (reloading automations, etc.).

## Usage

1. **Select a group** - Choose between Automations or Scripts in the left sidebar
2. **Select an item** - Click any automation or script to load it in the editor
3. **Edit visually** - Modify triggers, conditions, and actions using the visual blocks
4. **Toggle to YAML** - Click the Visual/YAML toggle to see or edit raw YAML
5. **Save** - Click Save to write changes and reload in Home Assistant

### Keyboard Shortcuts

| Shortcut | Action |
| :--- | :--- |
| `Cmd/Ctrl + S` | Save current item |
| `Escape` | Close modal dialogs |

## Version Control & History

The Home Assistant Editor includes deep integration with the [Home Assistant Version Control](https://github.com/saihgupr/HomeAssistantVersionControl) addon.

> [!IMPORTANT]
> To enable Version History features, you **must** have the **Home Assistant Version Control** addon installed and running on your instance.

## Contributing

Found a bug or have a feature idea? Please [open an issue](https://github.com/saihgupr/HomeAssistantEditor/issues).

Want to contribute code? Pull requests are welcome! We use the `main` branch for stable releases and the `develop` branch for active development.

## Support

Home Assistant Editor is open-source and free. If you find it useful, consider giving it a star ⭐ or making a [donation](https://ko-fi.com/saihgupr) to support development.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
