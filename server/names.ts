// Names for guests, like "Happy Mango". Friendly words only: the library's own adjective list has some that are not.
import { uniqueNamesGenerator } from 'unique-names-generator'

const MOODS = [
  'Happy', 'Sunny', 'Brave', 'Calm', 'Clever', 'Cheerful', 'Curious', 'Gentle', 'Jolly', 'Kind', 'Lively', 'Lucky',
  'Merry', 'Mighty', 'Nimble', 'Plucky', 'Quick', 'Quiet', 'Snappy', 'Spry', 'Steady', 'Swift', 'Witty', 'Zesty',
  'Bold', 'Bright', 'Bouncy', 'Cosy', 'Daring', 'Eager', 'Fuzzy', 'Glad', 'Golden', 'Hearty', 'Keen', 'Mellow',
]
const FRUITS = [
  'Apple', 'Apricot', 'Banana', 'Blackberry', 'Blueberry', 'Cherry', 'Clementine', 'Coconut', 'Cranberry', 'Date', 'Fig',
  'Grape', 'Guava', 'Kiwi', 'Kumquat', 'Lemon', 'Lime', 'Lychee', 'Mango', 'Melon', 'Nectarine', 'Olive', 'Orange',
  'Papaya', 'Peach', 'Pear', 'Persimmon', 'Pineapple', 'Plum', 'Pomelo', 'Quince', 'Raspberry', 'Strawberry', 'Tangerine',
]

export const guestName = () => uniqueNamesGenerator({ dictionaries: [MOODS, FRUITS], separator: ' ', length: 2 })
