/**
 * lib/sketchData.ts — the kitchen sketches a recipe without a picture shows
 * (Oct 8): twenty line drawings on a 64x64 grid, two per meal type plus a
 * pair for a recipe with no meal type. DATA ONLY and generated once from the
 * mock-up Sean chose; components/library/MealTypeArt.tsx draws it with
 * react-native-svg, lib/mealTypeArt.ts says which sketch a recipe gets.
 *
 * A shape's `fill` is a role, never a colour: 'soft' is the ink at 20%
 * (the wash inside an outline), 'paper' is the card behind the drawing (a
 * cut-out), 'solid' is the ink. No role means no fill. Colour comes from the
 * book the recipe is in, so nothing here names one.
 */

export type SketchFill = 'soft' | 'paper' | 'solid';

export interface SketchShape {
  t: 'path' | 'circle' | 'rect' | 'ellipse';
  d?: string;
  cx?: number;
  cy?: number;
  r?: number;
  rx?: number;
  ry?: number;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  transform?: string;
  fill?: SketchFill;
  /** false: the shape is a fill only, with no outline. */
  stroke?: false;
  opacity?: number;
}

export const SKETCHES: Readonly<Record<string, readonly SketchShape[]>> = {
  pancakes: [{t:"path",d:"M13 44c0-4 38-4 38 0v2c0 2-38 2-38 0zM14 37c0-4 36-4 36 0v2c0 2-36 2-36 0zM15 30c0-4 34-4 34 0v2c0 2-34 2-34 0z",fill:"soft",stroke:false},{t:"path",d:"M8 51h48"},{t:"path",d:"M13 44c0-4 38-4 38 0v2c0 2-38 2-38 0z"},{t:"path",d:"M14 37c0-4 36-4 36 0v2c0 2-36 2-36 0z"},{t:"path",d:"M15 30c0-4 34-4 34 0v2c0 2-34 2-34 0z"},{t:"rect",rx:1.5,x:27.0,y:22.0,width:10.0,height:6.0,fill:"soft",stroke:false},{t:"rect",rx:1.5,x:27.0,y:22.0,width:10.0,height:6.0},{t:"path",d:"M44 31c1 3 1 6 0 9"}],
  egg: [{t:"circle",cx:30.0,cy:34.0,r:20.0,fill:"soft",stroke:false},{t:"circle",cx:30.0,cy:34.0,r:20.0},{t:"path",d:"M50 30h10"},{t:"path",d:"M50 36h10"},{t:"path",d:"M20 30c0-6 8-8 12-5 6 1 8 8 4 12-3 4-9 5-13 2-3-2-4-5-3-9z",fill:"paper"},{t:"circle",cx:29.0,cy:33.0,r:4.5,fill:"solid",stroke:false}],
  sandwich: [{t:"path",d:"M10 46L32 14l22 32z",fill:"soft",stroke:false},{t:"path",d:"M10 46L32 14l22 32z"},{t:"path",d:"M15 39c6 2 8-2 14 0s8-2 14 0 6-2 8-1"},{t:"path",d:"M10 46h44v5H10z",fill:"soft",stroke:false},{t:"path",d:"M10 46h44v5H10z"},{t:"circle",cx:26.0,cy:31.0,r:1.4,fill:"solid",stroke:false},{t:"circle",cx:35.0,cy:27.0,r:1.4,fill:"solid",stroke:false}],
  soup: [{t:"path",d:"M8 30h48c0 14-9 22-24 22S8 44 8 30z",fill:"soft",stroke:false},{t:"path",d:"M8 30h48c0 14-9 22-24 22S8 44 8 30z"},{t:"path",d:"M24 52v3h16v-3"},{t:"path",d:"M20 30c0-3 4-3 4-6M31 30c0-3 4-3 4-6M42 30c0-3 4-3 4-6"},{t:"path",d:"M48 14L36 28"},{t:"ellipse",cx:50.0,cy:12.0,rx:4.5,ry:3.5,transform:"rotate(-50 50 12)",fill:"soft",stroke:false}],
  pot: [{t:"path",d:"M12 30h40v14a8 8 0 0 1-8 8H20a8 8 0 0 1-8-8z",fill:"soft",stroke:false},{t:"path",d:"M12 30h40v14a8 8 0 0 1-8 8H20a8 8 0 0 1-8-8z"},{t:"path",d:"M12 35H7M52 35h5"},{t:"path",d:"M10 30c4-6 40-6 44 0"},{t:"path",d:"M29 23h6"},{t:"path",d:"M26 17c-2-3 2-4 0-7M38 17c-2-3 2-4 0-7"}],
  skillet: [{t:"circle",cx:26.0,cy:34.0,r:18.0,fill:"soft",stroke:false},{t:"circle",cx:26.0,cy:34.0,r:18.0},{t:"path",d:"M44 30h16a2 2 0 0 1 0 5H44"},{t:"path",d:"M14 36c0-7 6-12 13-11 6 1 10 5 9 11-1 5-6 7-12 7-6 0-10-3-10-7z",fill:"paper"},{t:"path",d:"M19 33c4-2 8-2 12 1"},{t:"path",d:"M22 14c-2-3 2-4 0-7M31 14c-2-3 2-4 0-7"}],
  cheese: [{t:"path",d:"M8 44V32L34 16l22 8v20z",fill:"soft",stroke:false},{t:"path",d:"M8 44V32L34 16l22 8v20z"},{t:"path",d:"M8 32l48-8"},{t:"circle",cx:22.0,cy:38.0,r:3.5,fill:"paper"},{t:"circle",cx:40.0,cy:36.0,r:2.6,fill:"paper"},{t:"circle",cx:47.0,cy:40.0,r:1.8,fill:"paper"}],
  skewer: [{t:"path",d:"M12 52L54 10"},{t:"circle",cx:24.0,cy:40.0,r:6.0,fill:"soft",stroke:false},{t:"circle",cx:24.0,cy:40.0,r:6.0},{t:"circle",cx:34.0,cy:30.0,r:6.0,fill:"soft",stroke:false},{t:"circle",cx:34.0,cy:30.0,r:6.0},{t:"rect",rx:2.0,x:40.0,y:14.0,width:10.0,height:10.0,transform:"rotate(45 45 19)",fill:"soft",stroke:false},{t:"rect",rx:2.0,x:40.0,y:14.0,width:10.0,height:10.0,transform:"rotate(45 45 19)"}],
  saladbowl: [{t:"path",d:"M8 32h48c0 12-10 20-24 20S8 44 8 32z",fill:"soft",stroke:false},{t:"path",d:"M8 32h48c0 12-10 20-24 20S8 44 8 32z"},{t:"path",d:"M24 52v3h16v-3"},{t:"path",d:"M17 32c-2-8 4-13 9-12-1 5-3 9-9 12z",fill:"soft",stroke:false},{t:"path",d:"M17 32c-2-8 4-13 9-12-1 5-3 9-9 12z"},{t:"path",d:"M28 32c2-9 10-12 15-9-3 5-8 8-15 9z",fill:"soft",stroke:false},{t:"path",d:"M28 32c2-9 10-12 15-9-3 5-8 8-15 9z"},{t:"circle",cx:46.0,cy:28.0,r:4.5,fill:"paper"}],
  tomato: [{t:"path",d:"M32 20c-14 0-22 8-22 20 0 9 9 14 22 14s22-5 22-14c0-12-8-20-22-20z",fill:"soft",stroke:false},{t:"path",d:"M32 20c-14 0-22 8-22 20 0 9 9 14 22 14s22-5 22-14c0-12-8-20-22-20z"},{t:"path",d:"M32 20l-8-5 5 1-2-6 6 5 3-6 1 6 6-3-3 6 6 0-8 3"},{t:"path",d:"M20 38c0-4 2-7 5-8"}],
  cake: [{t:"path",d:"M10 50V32l40-12v30z",fill:"soft",stroke:false},{t:"path",d:"M10 50V32l40-12v30z"},{t:"path",d:"M10 41l40-9"},{t:"path",d:"M10 32c4 3 6-2 10 1s6-3 10 0 6-4 10-1 6-5 10-6"},{t:"circle",cx:34.0,cy:15.0,r:3.5,fill:"solid",stroke:false},{t:"path",d:"M35 11.5c1-3 3-4 5-4"}],
  cupcake: [{t:"path",d:"M14 36h36l-5 18H19z",fill:"soft",stroke:false},{t:"path",d:"M14 36h36l-5 18H19z"},{t:"path",d:"M24 36l2 18M32 36v18M40 36l-2 18"},{t:"path",d:"M12 36c-2-9 6-12 9-11 1-7 12-9 15-3 8-1 14 6 12 14z",fill:"soft",stroke:false},{t:"path",d:"M12 36c-2-9 6-12 9-11 1-7 12-9 15-3 8-1 14 6 12 14z"},{t:"circle",cx:32.0,cy:12.0,r:3.5,fill:"solid",stroke:false}],
  loaf: [{t:"path",d:"M10 50V35c0-10 8-15 22-15s22 5 22 15v15z",fill:"soft",stroke:false},{t:"path",d:"M10 50V35c0-10 8-15 22-15s22 5 22 15v15z"},{t:"path",d:"M21 28l-3 8M32 26v10M43 28l3 8"}],
  rollingpin: [{t:"rect",rx:4.0,x:16.0,y:25.0,width:32.0,height:14.0,transform:"rotate(-35 32 32)",fill:"soft",stroke:false},{t:"rect",rx:4.0,x:16.0,y:25.0,width:32.0,height:14.0,transform:"rotate(-35 32 32)"},{t:"path",d:"M16 32H6M48 32h10",transform:"rotate(-35 32 32)"},{t:"circle",cx:5.0,cy:32.0,r:3.0,transform:"rotate(-35 32 32)",fill:"solid",stroke:false},{t:"circle",cx:59.0,cy:32.0,r:3.0,transform:"rotate(-35 32 32)",fill:"solid",stroke:false},{t:"path",d:"M12 54h14M36 54h14",opacity:0.5}],
  mug: [{t:"path",d:"M14 26h30v18a8 8 0 0 1-8 8H22a8 8 0 0 1-8-8z",fill:"soft",stroke:false},{t:"path",d:"M14 26h30v18a8 8 0 0 1-8 8H22a8 8 0 0 1-8-8z"},{t:"path",d:"M44 30h4a6 6 0 0 1 0 12h-4"},{t:"path",d:"M23 20c-2-3 2-4 0-7M33 20c-2-3 2-4 0-7"}],
  glass: [{t:"path",d:"M16 16h32l-4 36H20z",fill:"soft",stroke:false},{t:"path",d:"M16 16h32l-4 36H20z"},{t:"path",d:"M18 26h28"},{t:"rect",rx:1.5,x:24.0,y:31.0,width:8.0,height:8.0,transform:"rotate(-12 28 35)",fill:"paper"},{t:"rect",rx:1.5,x:33.0,y:35.0,width:8.0,height:8.0,transform:"rotate(10 37 39)",fill:"paper"},{t:"path",d:"M38 16l8-10"}],
  corn: [{t:"rect",rx:10.0,x:22.0,y:8.0,width:20.0,height:40.0,transform:"rotate(35 32 32)",fill:"soft",stroke:false},{t:"rect",rx:10.0,x:22.0,y:8.0,width:20.0,height:40.0,transform:"rotate(35 32 32)"},{t:"path",d:"M22 20h20M22 30h20M32 8v40",transform:"rotate(35 32 32)"},{t:"path",d:"M14 48c6-4 12-2 16 6-8 2-14 0-16-6zM50 48c-6-4-12-2-16 6 8 2 14 0 16-6z",fill:"soft",stroke:false},{t:"path",d:"M14 48c6-4 12-2 16 6-8 2-14 0-16-6zM50 48c-6-4-12-2-16 6 8 2 14 0 16-6z"}],
  carrot: [{t:"path",d:"M40 22L12 54c-2-6 0-18 8-26 6-6 14-8 20-6z",fill:"soft",stroke:false},{t:"path",d:"M40 22L12 54c-2-6 0-18 8-26 6-6 14-8 20-6z"},{t:"path",d:"M22 34l6 2M18 42l5 1M28 28l4 2"},{t:"path",d:"M40 22c0-6 4-10 10-12-1 6-3 9-8 12zM40 22c2-6 8-8 14-6-3 5-8 7-13 7zM40 22c-4-5-3-10 0-14 3 4 3 9 0 14z"}],
  whisk: [{t:"path",d:"M32 36c-10-4-12-26 0-28 12 2 10 24 0 28z",fill:"soft",stroke:false},{t:"path",d:"M32 36c-10-4-12-26 0-28 12 2 10 24 0 28z"},{t:"path",d:"M32 36c-4-6-4-22 0-28M32 36c4-6 4-22 0-28"},{t:"path",d:"M32 36v10"},{t:"rect",rx:3.0,x:29.0,y:44.0,width:6.0,height:14.0,fill:"soft",stroke:false},{t:"rect",rx:3.0,x:29.0,y:44.0,width:6.0,height:14.0}],
  openbook: [{t:"path",d:"M6 18c9-3 18-2 26 3v33c-8-5-17-6-26-3z",fill:"soft",stroke:false},{t:"path",d:"M58 18c-9-3-18-2-26 3v33c8-5 17-6 26-3z",fill:"soft",stroke:false},{t:"path",d:"M6 18c9-3 18-2 26 3v33c-8-5-17-6-26-3z"},{t:"path",d:"M58 18c-9-3-18-2-26 3v33c8-5 17-6 26-3z"},{t:"path",d:"M13 26c5-1 9 0 13 2M13 33c5-1 9 0 13 2M38 28c4-2 8-3 13-2M38 35c4-2 8-3 13-2",opacity:0.6}],
};
