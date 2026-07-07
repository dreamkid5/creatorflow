CLOUD SCRIPTS FOLDER

This folder feeds the cloud automation that runs on GitHub every day.

How to add a video:
1. Create a plain text file in this folder. Name it whatever you want the video
   titled, for example: The History of Chamomile.txt
2. Write your narration script inside, as normal sentences. Each sentence or two
   becomes a scene.
3. Commit and push the file to GitHub.

On the next daily run, or when you trigger it by hand from the Actions tab, the
cloud renders each new script into a narrated illustrated video, writes the SEO
with Claude, and publishes it to YouTube. After publishing, the script is moved
into the published folder so it is not made twice.

Files whose name starts with an underscore, like this one, are ignored.
