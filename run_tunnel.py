import subprocess
import os
import sys
import shutil

def main():
    print("==================================================")
    print(" PassBiometric SSH Tunnel Setup Utility")
    print("==================================================")

    # 1. Verify that the SSH client is available in system PATH
    if not shutil.which("ssh"):
        print("Error: 'ssh' command-line client was not found in your system PATH.")
        print("Please make sure OpenSSH Client is installed or add it to PATH.")
        input("\nPress Enter to exit...")
        sys.exit(1)

    # 2. Resolve default SSH key path
    home = os.path.expanduser("~")
    ssh_dir = os.path.join(home, ".ssh")
    key_path = os.path.join(ssh_dir, "id_rsa")

    # 3. Check for keys, auto-generate key pair if missing
    if not os.path.exists(key_path):
        print(f"\nNo SSH key found at: {key_path}")
        print("Generating a new 2048-bit RSA key pair for secure tunnel authentication...")
        try:
            os.makedirs(ssh_dir, exist_ok=True)
            # Run ssh-keygen non-interactively
            subprocess.run([
                "ssh-keygen",
                "-t", "rsa",
                "-b", "2048",
                "-f", key_path,
                "-N", ""
            ], check=True)
            print(f"Successfully generated SSH keys at: {key_path}")
        except Exception as e:
            print(f"Failed to automatically generate SSH keys: {e}")
            print("Please run this command manually in your terminal first:")
            print("ssh-keygen -t rsa -b 2048")
            input("\nPress Enter to exit...")
            sys.exit(1)

    # 4. Prompt for preferred subdomain prefix
    print("\nSelect a unique subdomain prefix for your live URL.")
    print("Leave empty for a random subdomain.")
    preferred = input("Enter preferred subdomain [example: my-attendance]: ").strip()

    # Sanitize prefix characters
    preferred = "".join(c for c in preferred if c.isalnum() or c in "-").lower()

    if preferred:
        subdomain_arg = f"{preferred}:80:127.0.0.1:8000"
        display_sub = preferred
    else:
        subdomain_arg = "80:127.0.0.1:8000"
        display_sub = "[Random Subdomain]"

    print("\nConnecting to Serveo...")
    print(f"Subdomain: {display_sub}")
    print(f"SSH Key: {key_path}")
    print("=" * 50)

    # 5. Build and execute reverse port forwarding command
    cmd = [
        "ssh",
        "-i", key_path,
        "-R", subdomain_arg,
        "-o", "StrictHostKeyChecking=no",
        "-o", "UserKnownHostsFile=/dev/null",
        "-o", "ServerAliveInterval=60",
        "serveo.net"
    ]

    try:
        proc = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1
        )
        
        # Monitor the output and extract registration links
        for line in iter(proc.stdout.readline, ""):
            print(line, end="", flush=True)
            
            # Highlight registration url if Serveo outputs it
            if "console.serveo.net/ssh/keys?add=" in line:
                print("\n" + "=" * 60)
                print("⚠️  [SUBDOMAIN AUTHENTICATION NUDGE]")
                print("To lock this subdomain permanently to your SSH key, visit:")
                print(line.strip())
                print("=" * 60 + "\n", flush=True)

    except KeyboardInterrupt:
        print("\nClosing tunnel...")
    except Exception as e:
        print(f"\nError running SSH tunnel: {e}")

    input("\nPress Enter to exit...")

if __name__ == "__main__":
    main()
