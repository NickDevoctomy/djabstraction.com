#!/usr/bin/env ruby
# frozen_string_literal: true

# Validates the generated feeds in the built site. Run after `jekyll build`;
# exits non-zero if either feed is broken, so CI fails before deploying.
#
# Usage: bundle exec ruby .github/scripts/validate-feeds.rb [site_dir]

require "rexml/document"
require "time"
require "uri"

SITE_DIR = ARGV[0] || "_site"

NS = {
  "atom" => "http://www.w3.org/2005/Atom",
  "itunes" => "http://www.itunes.com/dtds/podcast-1.0.dtd",
  "psc" => "http://podlove.org/simple-chapters"
}.freeze

$errors = []

def error(where, msg) = $errors << "#{where}: #{msg}"

def first(node, xpath) = REXML::XPath.first(node, xpath, NS)
def all(node, xpath) = REXML::XPath.match(node, xpath, NS)
def text_of(node, xpath) = first(node, xpath)&.text.to_s.strip
def attr_of(node, xpath, name) = first(node, xpath)&.attributes&.[](name).to_s.strip

def http_url?(value)
  uri = URI.parse(value)
  %w[http https].include?(uri.scheme) && !uri.host.to_s.empty?
rescue URI::InvalidURIError
  false
end

def positive_int?(value) = value.match?(/\A\d+\z/) && value.to_i.positive?

def check_image(where, href)
  return if http_url?(href) && href.match?(/\.(jpe?g|png)\z/i)

  error(where, "<itunes:image href> must be a .jpg or .png URL, got #{href.inspect}")
end

def parse_xml(path)
  unless File.exist?(path)
    error(path, "file not found (did jekyll build run?)")
    return nil
  end
  REXML::Document.new(File.read(path))
rescue REXML::ParseException => e
  error(path, "not well-formed XML: #{e.message.lines.first.strip}")
  nil
end

def require_text(where, node, xpath)
  error(where, "missing or empty <#{xpath}>") if text_of(node, xpath).empty?
end

def check_podcast(path)
  doc = parse_xml(path) or return
  rss = doc.root
  unless rss&.name == "rss" && rss.attributes["version"] == "2.0"
    error(path, "root element must be <rss version=\"2.0\">")
    return
  end
  channel = first(rss, "channel") or return error(path, "missing <channel>")

  %w[title link description language itunes:author].each { |x| require_text(path, channel, x) }
  error(path, "channel <link> is not an http(s) URL") unless http_url?(text_of(channel, "link"))
  check_image("#{path} channel", attr_of(channel, "itunes:image", "href"))
  error(path, "channel has no <itunes:category text>") if attr_of(channel, "itunes:category", "text").empty?
  unless %w[true false].include?(text_of(channel, "itunes:explicit").downcase)
    error(path, "channel <itunes:explicit> must be true or false")
  end

  items = all(channel, "item")
  error(path, "feed has no <item> entries") if items.empty?

  seen = Hash.new { |h, k| h[k] = {} }
  items.each_with_index do |item, i|
    title = text_of(item, "title")
    where = "#{path} item #{i + 1} (#{title.empty? ? 'untitled' : title})"

    require_text(where, item, "title")
    require_text(where, item, "description")

    { "guid" => text_of(item, "guid"),
      "enclosure url" => attr_of(item, "enclosure", "url"),
      "itunes:episode" => text_of(item, "itunes:episode") }.each do |field, value|
      next if value.empty?
      error(where, "duplicate #{field} #{value} (also #{seen[field][value]})") if seen[field].key?(value)
      seen[field][value] = "item #{i + 1}"
    end

    error(where, "missing <guid>") if text_of(item, "guid").empty?
    error(where, "<link> is not an http(s) URL") unless http_url?(text_of(item, "link"))

    begin
      Time.rfc2822(text_of(item, "pubDate"))
    rescue ArgumentError
      error(where, "<pubDate> is not an RFC 822 date: #{text_of(item, 'pubDate').inspect}")
    end

    enclosure = first(item, "enclosure")
    if enclosure.nil?
      error(where, "missing <enclosure>")
    else
      error(where, "<enclosure url> is not an http(s) URL") unless http_url?(enclosure.attributes["url"].to_s)
      error(where, "<enclosure length> must be a positive integer") unless positive_int?(enclosure.attributes["length"].to_s)
      error(where, "<enclosure type> must be audio/mpeg") unless enclosure.attributes["type"] == "audio/mpeg"
    end

    error(where, "<itunes:duration> must be a positive number of seconds") unless positive_int?(text_of(item, "itunes:duration"))
    error(where, "<itunes:episode> must be a positive integer") unless positive_int?(text_of(item, "itunes:episode"))

    check_image(where, attr_of(item, "itunes:image", "href"))

    previous_start = -1
    all(item, "psc:chapters/psc:chapter").each_with_index do |chapter, c|
      start = chapter.attributes["start"].to_s
      unless start.match?(/\A\d{1,2}:\d{2}:\d{2}(\.\d+)?\z/)
        error(where, "chapter #{c + 1} start #{start.inspect} is not HH:MM:SS")
        next
      end
      h, m, s = start.split(":").map(&:to_f)
      seconds = (h * 3600) + (m * 60) + s
      error(where, "chapter #{c + 1} starts before the previous chapter") if seconds < previous_start
      previous_start = seconds
      error(where, "chapter #{c + 1} has an empty title") if chapter.attributes["title"].to_s.strip.empty?
      href = chapter.attributes["href"].to_s
      error(where, "chapter #{c + 1} href #{href.inspect} is not an http(s) URL") unless href.empty? || http_url?(href)
    end
  end

  puts "#{path}: #{items.size} items checked"
end

def check_atom(path)
  doc = parse_xml(path) or return
  feed = doc.root
  unless feed&.name == "feed" && feed.namespace == NS["atom"]
    error(path, "root element must be an Atom <feed>")
    return
  end

  %w[atom:id atom:title atom:updated].each { |x| require_text(path, feed, x) }
  check_iso8601(path, text_of(feed, "atom:updated"))

  entries = all(feed, "atom:entry")
  error(path, "feed has no <entry> elements") if entries.empty?

  ids = {}
  entries.each_with_index do |entry, i|
    where = "#{path} entry #{i + 1}"
    id = text_of(entry, "atom:id")
    error(where, "missing <id>") if id.empty?
    error(where, "duplicate <id> #{id}") if ids.key?(id)
    ids[id] = true
    require_text(where, entry, "atom:title")
    check_iso8601(where, text_of(entry, "atom:updated"))
    error(where, "<link href> is not an http(s) URL") unless http_url?(attr_of(entry, "atom:link", "href"))
  end

  puts "#{path}: #{entries.size} entries checked"
end

def check_iso8601(where, value)
  Time.iso8601(value)
rescue ArgumentError
  error(where, "<updated> is not an ISO 8601 date: #{value.inspect}")
end

check_podcast(File.join(SITE_DIR, "feed", "podcast.xml"))
check_atom(File.join(SITE_DIR, "feed.xml"))

if $errors.any?
  $errors.each { |e| puts "::error::#{e}" }
  puts "Feed validation failed with #{$errors.size} error(s)."
  exit 1
end
puts "Feeds OK."
