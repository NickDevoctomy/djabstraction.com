---
layout: page
title: Podcast
description: Setting up a player
background: '/img/bg-about.jpg'
---

To make listening to my mixes as easy as possible I've created a Podcast feed which you should be able to subscribe to using any good Podcast player on your smartphone or other device.

Once you have picked a podcast player and have installed it to your device, you will need to subscribe to the following DJ Abstraction Podcast feed (tap the button to copy it to the clipboard),

<div class="container">
	<div class="row">
		<div class="col text-center">
			<input type="text" value="https://www.djabstraction.com/feed/podcast.xml" id="podcastUrl" style="width: 100%;pointer-events: none;border: 0px solid;text-align: center;" />
			<button id="copyButton" onclick="copyPodcastUrlToClipboard()" class="btn btn-secondary">Copy Podcast Feed</button>
		</div>
	</div>
</div>

> This feed link is available at the bottom of every page via the social links.

To make things super simple, I have made my podcast available on <a href="https://play.google.com/store/apps/details?id=de.danoeh.antennapod&amp;pcampaignid=web_share">AntennaPod for Android</a>. Simply install the app and click the link below, or search for my podcast via the term 'DJ Abstraction'.

<a href="https://antennapod.org/deeplink/subscribe?url=https%3A%2F%2Fwww.djabstraction.com%2Ffeed%2Fpodcast.xml&amp;title=DJ%20Abstraction%27s%20Warmup%20Sessions"><img src="/img/podcast/apbadge.png" width="250" /></a>	

Once subscribed you should receieve notifications of new mixes as they go live and be able to listen straight away without any messing about.

Enjoy!	

<script>
function copyPodcastUrlToClipboard() {
  var podcastUrl = document.getElementById("podcastUrl");
  podcastUrl.select();
  podcastUrl.setSelectionRange(0, 99999);
  document.execCommand("copy");
  alert("Copied the text: " + podcastUrl.value);
  podcastUrl.setSelectionRange(0, 0);
  var copyButton = document.getElementById("copyButton");
  copyButton.select();
}
</script>