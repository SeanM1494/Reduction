/**
 * client/src/data/seed.ts
 *
 * One worked example so a fresh install has something to look at. Safe to
 * delete along with the seeding branch in App.tsx.
 */

import type { Recipe } from "./layout";

export const SEED: Recipe = {
  title: "Plain New York Style Cheesecake",
  servings: 12,
  yieldText: "serves twelve",
  source: "cookingforengineers.com",
  sourceUrl:
    "https://www.cookingforengineers.com/recipe/89/Cheesecake-Plain-New-York-Style",
  sections: [
    {
      name: "Graham cracker crust",
      header: "Oven 325\u00b0F",
      ingredients: [
        { id: "crust_crackers", qty: 4, unit: "oz", name: "graham crackers" },
        { id: "crust_butter", qty: 4, unit: "tbsp", name: "butter" },
        { id: "crust_sugar", qty: 1, unit: "tbsp", name: "sugar" },
      ],
      nodes: [
        { id: "crust_1", label: "process to crumbs", inputs: ["crust_crackers"] },
        { id: "crust_2", label: "melt", inputs: ["crust_butter"] },
        {
          id: "crust_3",
          label: "mix",
          inputs: ["crust_1", "crust_2", "crust_sugar"],
        },
        { id: "crust_4", label: "press into 10-in pan", inputs: ["crust_3"] },
        {
          id: "crust_5",
          label: "bake 325\u00b0F 12 min",
          inputs: ["crust_4"],
          minutes: 12,
          tempF: 325,
        },
      ],
      root: "crust_5",
    },
    {
      name: "Cheesecake",
      header: "Oven 500\u00b0F",
      ingredients: [
        {
          id: "f_cheese",
          qty: 2.5,
          unit: "lb",
          name: "cream cheese",
          note: "softened",
        },
        { id: "f_salt", qty: 0.125, unit: "tsp", name: "salt" },
        { id: "f_sugar", qty: 1.75, unit: "cup", name: "sugar" },
        { id: "f_flour", qty: 3, unit: "tbsp", name: "flour", note: "optional" },
        { id: "f_lemon", qty: 2, unit: "tsp", name: "lemon juice" },
        { id: "f_vanilla", qty: 1, unit: "tsp", name: "vanilla extract" },
        { id: "f_cream", qty: 0.5, unit: "cup", name: "heavy cream" },
        { id: "f_yolks", qty: 2, unit: null, name: "large egg yolks" },
        { id: "f_eggs", qty: 6, unit: null, name: "large eggs" },
        { id: "f_crust", qty: 1, unit: null, name: "graham cracker crust" },
      ],
      nodes: [
        { id: "f1", label: "mix until smooth", inputs: ["f_cheese"] },
        { id: "f2", label: "mix", inputs: ["f1", "f_salt"] },
        { id: "f3", label: "mix in thirds", inputs: ["f2", "f_sugar"] },
        { id: "f4", label: "mix", inputs: ["f3", "f_flour"] },
        { id: "f5", label: "mix", inputs: ["f4", "f_lemon", "f_vanilla"] },
        { id: "f6", label: "mix", inputs: ["f5", "f_cream"] },
        { id: "f7", label: "mix in halves", inputs: ["f6", "f_yolks", "f_eggs"] },
        {
          id: "f8",
          label: "bake 500\u00b0F 10 min",
          inputs: ["f7", "f_crust"],
          minutes: 10,
          tempF: 500,
        },
        {
          id: "f9",
          label: "bake 200\u00b0F 100 min",
          inputs: ["f8"],
          minutes: 100,
          tempF: 200,
        },
      ],
      root: "f9",
    },
  ],
};
